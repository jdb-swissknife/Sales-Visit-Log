import { and, eq, isNotNull, lte, sql } from "drizzle-orm";
import {
  db,
  visitsTable,
  businessesTable,
  agentRunsTable,
  agentSuggestionsTable,
  type AgentSuggestion,
} from "@workspace/db";
import { logger } from "./logger";
import { suggestionBus } from "./suggestion-bus";
import { logEvent } from "./events";

/**
 * Deterministic, in-app callback-reminder cron (no LLM, no external agent).
 *
 * Low-risk, fully deterministic suggestions are produced inside the api-server;
 * only LLM / memory reasoning belongs in the external Hermes agent. This module
 * is the first in-app suggestion producer and demonstrates the agent-run
 * lifecycle (queued -> running -> completed/skipped) end to end.
 *
 * Each sweep:
 *   1. Opens one `agent_runs` row and walks its lifecycle.
 *   2. Finds visits whose `nextActionDate` is due today or overdue and that
 *      have NOT been superseded by a later visit to the same business.
 *   3. Upserts one `callback_reminder` suggestion per open callback, keyed by
 *      `cb-due:{visitId}:{date}` so re-runs refresh rather than stack, with
 *      `expiresAt` = end of the configured local day.
 *   4. Closes the run as `completed` (with counts), `skipped`, or `failed`.
 *
 * Single-instance only — fine for the Replit deployment.
 */

const ENABLED = (process.env.CALLBACK_CRON_ENABLED ?? "true") !== "false";
// Hour (0-23) in the rep's local day at which the daily sweep fires.
const CRON_HOUR = clampInt(process.env.CALLBACK_CRON_HOUR, 7, 0, 23);
// Minutes to add to UTC to reach the rep's local time (e.g. -300 for US Eastern
// standard). Used to define "today" and the fire hour. Defaults to UTC.
const TZ_OFFSET_MIN = Number(process.env.CALLBACK_CRON_TZ_OFFSET_MIN ?? "0") || 0;

let sweepInFlight = false;

export interface SweepResult {
  total: number;
  emitted: number;
  refreshed: number;
  overdue: number;
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Start/end of "today" and a YYYY-MM-DD key, all in the configured local frame. */
function dayBounds(now: Date): { startOfToday: Date; endOfToday: Date; dateKey: string } {
  const local = new Date(now.getTime() + TZ_OFFSET_MIN * 60_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  const startMs = Date.UTC(y, m, d, 0, 0, 0, 0) - TZ_OFFSET_MIN * 60_000;
  const endMs = Date.UTC(y, m, d, 23, 59, 59, 999) - TZ_OFFSET_MIN * 60_000;
  return {
    startOfToday: new Date(startMs),
    endOfToday: new Date(endMs),
    dateKey: `${y}-${pad(m + 1)}-${pad(d)}`,
  };
}

/** Milliseconds from `now` until the next CRON_HOUR:00 in the local frame. */
function msUntilNextFire(now: Date): number {
  const local = new Date(now.getTime() + TZ_OFFSET_MIN * 60_000);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth();
  const d = local.getUTCDate();
  let targetUtcMs = Date.UTC(y, m, d, CRON_HOUR, 0, 0, 0) - TZ_OFFSET_MIN * 60_000;
  if (targetUtcMs <= now.getTime()) targetUtcMs += 24 * 60 * 60 * 1000;
  return targetUtcMs - now.getTime();
}

/**
 * Run a single callback-reminder sweep. Never throws — a failed sweep records
 * itself on the agent_runs row and is retried on the next tick.
 */
export async function runCallbackSweep(reason = "scheduled"): Promise<SweepResult | null> {
  if (!ENABLED) return null;
  if (sweepInFlight) {
    logger.info("callback sweep already in flight; skipping");
    return null;
  }
  sweepInFlight = true;

  const now = new Date();
  const { startOfToday, endOfToday, dateKey } = dayBounds(now);
  const eventId = `cron:callback-sweep:${now.toISOString()}`;

  // 1. Open the run (queued -> running) so the lifecycle is observable.
  let runId: number | null = null;
  try {
    const [queued] = await db
      .insert(agentRunsTable)
      .values({ eventId, eventType: "callback.sweep", status: "queued" })
      .returning({ id: agentRunsTable.id });
    runId = queued?.id ?? null;
    if (runId !== null) {
      await db
        .update(agentRunsTable)
        .set({ status: "running", startedAt: now })
        .where(eq(agentRunsTable.id, runId));
    }
  } catch (err) {
    logger.error({ err }, "callback sweep: failed to open run");
    sweepInFlight = false;
    return null;
  }

  try {
    // 2. Open, due-or-overdue callbacks: a visit with a due nextActionDate that
    //    has NOT been superseded by a later visit to the same business.
    const due = await db
      .select({
        visitId: visitsTable.id,
        businessId: visitsTable.businessId,
        businessName: businessesTable.name,
        address: businessesTable.address,
        contactName: visitsTable.contactName,
        nextActionDate: visitsTable.nextActionDate,
      })
      .from(visitsTable)
      .leftJoin(businessesTable, eq(visitsTable.businessId, businessesTable.id))
      .where(
        and(
          isNotNull(visitsTable.nextActionDate),
          lte(visitsTable.nextActionDate, endOfToday),
          sql`NOT EXISTS (SELECT 1 FROM ${visitsTable} AS later
                WHERE later.business_id = ${visitsTable.businessId}
                  AND later.visited_at > ${visitsTable.visitedAt})`,
        ),
      )
      .orderBy(visitsTable.nextActionDate);

    let emitted = 0;
    let refreshed = 0;
    let overdueCount = 0;

    for (const cb of due) {
      const dueDate = cb.nextActionDate as Date;
      const isOverdue = dueDate < startOfToday;
      if (isOverdue) overdueCount += 1;

      const name = cb.businessName ?? `Prospect #${cb.businessId}`;
      const where = cb.address ? ` at ${cb.address}` : "";
      const whenLabel = isOverdue ? `Overdue since ${formatDate(dueDate)}` : "Due today";
      const contact = cb.contactName ? ` Contact: ${cb.contactName}.` : "";
      const dedupeKey = `cb-due:${cb.visitId}:${dateKey}`;

      const [existing] = await db
        .select({ id: agentSuggestionsTable.id })
        .from(agentSuggestionsTable)
        .where(eq(agentSuggestionsTable.dedupeKey, dedupeKey))
        .limit(1);

      const values = {
        externalId: null,
        agentRunId: runId,
        type: "callback_reminder",
        title: `${isOverdue ? "Overdue callback" : "Callback due"}: ${name}`,
        body: `Follow up with ${name}${where}. ${whenLabel}.${contact}`,
        businessId: cb.businessId,
        repId: null,
        priority: isOverdue ? "high" : "normal",
        priorityScore: null,
        status: "unread",
        dedupeKey,
        actionLabel: "Open prospect",
        actionUrl: `/businesses/${cb.businessId}`,
        data: {
          visitId: cb.visitId,
          dueDate: dueDate.toISOString(),
          overdue: isOverdue,
          contactName: cb.contactName ?? null,
        },
        source: "system",
        expiresAt: endOfToday,
      };

      const [row] = await db
        .insert(agentSuggestionsTable)
        .values(values)
        .onConflictDoUpdate({
          target: agentSuggestionsTable.dedupeKey,
          set: {
            agentRunId: values.agentRunId,
            type: values.type,
            title: values.title,
            body: values.body,
            businessId: values.businessId,
            priority: values.priority,
            actionLabel: values.actionLabel,
            actionUrl: values.actionUrl,
            data: values.data,
            expiresAt: values.expiresAt,
          },
        })
        .returning();

      if (!row) continue;
      if (existing) refreshed += 1;
      else emitted += 1;

      suggestionBus.publish(row as AgentSuggestion);

      if (!existing) {
        void logEvent({
          type: "suggestion.created",
          entityType: "suggestion",
          entityId: row.id,
          businessId: row.businessId,
          payload: { suggestionType: row.type, title: row.title, source: "callback-cron" },
        });
      }
    }

    const result: SweepResult = { total: due.length, emitted, refreshed, overdue: overdueCount };

    // 4. Close the run.
    if (runId !== null) {
      await db
        .update(agentRunsTable)
        .set({
          status: due.length === 0 ? "skipped" : "completed",
          finishedAt: new Date(),
          error: due.length === 0 ? "no callbacks due" : null,
          output: { ...result, reason, dateKey },
        })
        .where(eq(agentRunsTable.id, runId));
    }

    logger.info({ ...result, reason, runId }, "callback sweep complete");
    return result;
  } catch (err) {
    logger.error({ err, runId }, "callback sweep failed");
    if (runId !== null) {
      await db
        .update(agentRunsTable)
        .set({
          status: "failed",
          finishedAt: new Date(),
          error: err instanceof Error ? err.message : String(err),
        })
        .where(eq(agentRunsTable.id, runId))
        .catch(() => undefined);
    }
    return null;
  } finally {
    sweepInFlight = false;
  }
}

function formatDate(d: Date): string {
  const local = new Date(d.getTime() + TZ_OFFSET_MIN * 60_000);
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/**
 * Start the daily callback sweep. Runs once shortly after boot (so a fresh
 * deploy immediately populates the feed) and then every day at CRON_HOUR local
 * time, re-arming itself after each fire.
 */
export function startCallbackCron(): void {
  if (!ENABLED) {
    logger.info("callback cron disabled (CALLBACK_CRON_ENABLED=false)");
    return;
  }

  // Initial sweep a few seconds after boot, once the DB is reachable.
  setTimeout(() => {
    void runCallbackSweep("startup");
  }, 10_000).unref?.();

  const arm = (): void => {
    const delay = msUntilNextFire(new Date());
    setTimeout(() => {
      void runCallbackSweep("daily");
      arm();
    }, delay).unref?.();
    logger.info(
      { hours: Math.round((delay / 3_600_000) * 10) / 10, cronHour: CRON_HOUR },
      "callback cron armed for next daily sweep",
    );
  };
  arm();
}
