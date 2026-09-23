import { eq } from "drizzle-orm";
import { db, businessesTable } from "@workspace/db";
import { logEvent } from "./events";
import { deriveStageAfterVisit, stageTransition, type PipelineStage, type VisitSignal } from "./pipeline";

export interface MoveStageOptions {
  businessId: number;
  to: PipelineStage;
  repId?: string | null;
  /** What caused the move — surfaces in the event payload for Hermes. */
  reason: "visit" | "manual";
  visitId?: number | null;
  now?: Date;
}

/**
 * Move a prospect to `to` if it isn't already there. Stamps stageChangedAt /
 * closedAt and logs `business.stage_changed`. Returns the new status, or
 * null when nothing changed (or the business doesn't exist).
 */
export async function moveStage(opts: MoveStageOptions): Promise<PipelineStage | null> {
  const [current] = await db
    .select({ status: businessesTable.status, name: businessesTable.name })
    .from(businessesTable)
    .where(eq(businessesTable.id, opts.businessId));
  if (!current) return null;

  const transition = stageTransition(current.status, opts.to, opts.now);
  if (!transition) return null;

  await db
    .update(businessesTable)
    .set({ ...transition, updatedAt: transition.stageChangedAt })
    .where(eq(businessesTable.id, opts.businessId));

  void logEvent({
    type: "business.stage_changed",
    entityType: "business",
    entityId: opts.businessId,
    businessId: opts.businessId,
    visitId: opts.visitId ?? null,
    repId: opts.repId ?? null,
    payload: {
      from: current.status,
      to: transition.status,
      reason: opts.reason,
      businessName: current.name,
    },
  });

  return transition.status;
}

/**
 * Called after a visit is created or its outcome changes: derive the stage
 * from the visit and apply it (never demotes — see pipeline.ts).
 */
export async function applyVisitToStage(
  businessId: number,
  visit: VisitSignal & { id: number; repId?: string | null },
): Promise<PipelineStage | null> {
  const [current] = await db
    .select({ status: businessesTable.status })
    .from(businessesTable)
    .where(eq(businessesTable.id, businessId));
  if (!current) return null;

  const next = deriveStageAfterVisit(current.status, visit);
  if (next === current.status) return null;
  return moveStage({ businessId, to: next, repId: visit.repId, reason: "visit", visitId: visit.id });
}
