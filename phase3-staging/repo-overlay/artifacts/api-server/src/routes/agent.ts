/**
 * Agent API (R3) — consumed by the external Hermes agent. ALL routes behind requireAgentKey.
 *
 *   GET   /api/agent/events                recent app events for the agent to pull
 *   GET   /api/agent/context?businessId=   context bundle for a prospect
 *   POST  /api/agent/suggestions           upsert a suggestion (dedupeKey; priority medium→normal)
 *   PATCH /api/agent/runs/:id              update a queued/running agent run
 *   POST  /api/agent/prospect-insights     upsert a prospect insight ((businessId,type) or dedupeKey)
 *   POST  /api/agent/rep-insights          upsert a rep insight ((repId,type) or dedupeKey)
 *
 * No LLM calls here — this is the app's side of the contract. Hermes does the reasoning.
 *
 * ── ASSUMPTIONS to confirm at activation ─────────────────────────────────────
 *  A1. `db` + R1 tables (agentSuggestionsTable, agentRunsTable, insightsTable) exported
 *      from "@workspace/db".
 *  A2. [RESOLVED 2026-06-14] GET /events + GET /context now read the live Phase 2 tables
 *      (eventsTable / businessesTable / visitsTable / notesTable), verified against GitHub
 *      main. Key correction: notes has NO businessId — joined through visits. The agent
 *      WRITE endpoints (suggestions, runs, insights) depend only on R1 and are safe.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, desc, eq, gt } from "drizzle-orm";
import {
  db,
  agentSuggestionsTable,
  agentRunsTable,
  insightsTable,
  // PHASE2-DEP resolved 2026-06-14 against live GitHub main (Phase 2 baseline 2e15a06):
  // these are exported from "@workspace/db" via lib/db/src/schema/{events,businesses,visits,notes}.ts
  eventsTable,
  businessesTable,
  visitsTable,
  notesTable,
} from "@workspace/db";
import { requireAgentKey } from "../middlewares/agent-auth";
import { suggestionBus } from "../lib/suggestion-bus";

const router: IRouter = Router();
router.use(requireAgentKey);

/* ───────────────────────── helpers ───────────────────────── */

/** Contract priority → stored priority. `medium` is an accepted alias for `normal`. */
function normalizePriority(p: string | undefined): "low" | "normal" | "high" | "urgent" {
  switch (p) {
    case "low":
      return "low";
    case "high":
      return "high";
    case "urgent":
      return "urgent";
    case "medium":
    case "normal":
    case undefined:
      return "normal";
    default:
      return "normal";
  }
}

/* ───────────────────────── GET /events (PHASE2-DEP) ───────────────────────── */

const eventsQuery = z.object({
  since: z.coerce.date().optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

router.get("/events", async (req, res) => {
  const q = eventsQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "invalid_query", message: q.error.issues[0]?.message });
    return;
  }
  // PHASE2-DEP resolved 2026-06-14: live eventsTable has `createdAt` (timestamptz) and the
  // standard columns (id, type, entityType, entityId, businessId, visitId, payload, source).
  const conditions = q.data.since ? [gt(eventsTable.createdAt, q.data.since)] : [];
  const rows = await db
    .select()
    .from(eventsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(eventsTable.createdAt))
    .limit(q.data.limit);
  res.json({ events: rows });
});

/* ───────────────────────── GET /context (PHASE2-DEP) ───────────────────────── */

const contextQuery = z.object({ businessId: z.coerce.number().int() });

router.get("/context", async (req, res) => {
  const q = contextQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "invalid_query", message: q.error.issues[0]?.message });
    return;
  }
  const { businessId } = q.data;

  // R1-backed parts are safe to return now:
  const [insights, suggestions] = await Promise.all([
    db
      .select()
      .from(insightsTable)
      .where(and(eq(insightsTable.businessId, businessId), eq(insightsTable.status, "active")))
      .orderBy(desc(insightsTable.lastConfirmedAt)),
    db
      .select()
      .from(agentSuggestionsTable)
      .where(eq(agentSuggestionsTable.businessId, businessId))
      .orderBy(desc(agentSuggestionsTable.createdAt))
      .limit(20),
  ]);

  // PHASE2-DEP resolved 2026-06-14 against live schema:
  //   - businessesTable: PK `id`.
  //   - visitsTable: scoped by `businessId`; order by `visitedAt` (the real visit time).
  //   - notesTable has NO `businessId` — it references `visitId`, so notes for a business
  //     are reached by joining notes -> visits and filtering visits.businessId.
  const [business] = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.id, businessId))
    .limit(1);

  const visits = await db
    .select()
    .from(visitsTable)
    .where(eq(visitsTable.businessId, businessId))
    .orderBy(desc(visitsTable.visitedAt))
    .limit(10);

  const notes = await db
    .select({
      id: notesTable.id,
      visitId: notesTable.visitId,
      type: notesTable.type,
      content: notesTable.content,
      audioUrl: notesTable.audioUrl,
      durationSeconds: notesTable.durationSeconds,
      createdAt: notesTable.createdAt,
    })
    .from(notesTable)
    .innerJoin(visitsTable, eq(notesTable.visitId, visitsTable.id))
    .where(eq(visitsTable.businessId, businessId))
    .orderBy(desc(notesTable.createdAt))
    .limit(20);

  res.json({
    businessId,
    business: business ?? null,
    visits,
    notes,
    insights,
    suggestions,
  });
});

/* ───────────────────────── POST /suggestions ───────────────────────── */

const suggestionBody = z.object({
  externalId: z.string().min(1).optional(),
  businessId: z.number().int(),
  agentRunId: z.number().int().optional(),
  type: z.string().min(1),
  title: z.string().min(1),
  body: z.string().optional(),
  priority: z.enum(["low", "normal", "medium", "high", "urgent"]).optional(),
  dedupeKey: z.string().min(1).optional(),
});

router.post("/suggestions", async (req, res) => {
  const b = suggestionBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "invalid_body", message: b.error.issues[0]?.message });
    return;
  }
  const v = b.data;
  const values = {
    externalId: v.externalId ?? null,
    businessId: v.businessId,
    agentRunId: v.agentRunId ?? null,
    type: v.type,
    title: v.title,
    body: v.body ?? null,
    priority: normalizePriority(v.priority),
    dedupeKey: v.dedupeKey ?? null,
  };

  // Upsert on dedupeKey (or externalId) so repeated emits don't duplicate.
  let existing: { id: number } | undefined;
  if (v.dedupeKey) {
    [existing] = await db
      .select({ id: agentSuggestionsTable.id })
      .from(agentSuggestionsTable)
      .where(eq(agentSuggestionsTable.dedupeKey, v.dedupeKey))
      .limit(1);
  } else if (v.externalId) {
    [existing] = await db
      .select({ id: agentSuggestionsTable.id })
      .from(agentSuggestionsTable)
      .where(eq(agentSuggestionsTable.externalId, v.externalId))
      .limit(1);
  }

  if (existing) {
    const [updated] = await db
      .update(agentSuggestionsTable)
      .set({ ...values })
      .where(eq(agentSuggestionsTable.id, existing.id))
      .returning();
    suggestionBus.publish({ type: "updated", suggestion: updated });
    res.status(200).json({ suggestion: updated, upserted: "updated" });
    return;
  }

  const [created] = await db.insert(agentSuggestionsTable).values(values).returning();
  suggestionBus.publish({ type: "created", suggestion: created });
  res.status(201).json({ suggestion: created, upserted: "created" });
});

/* ───────────────────────── PATCH /runs/:id ───────────────────────── */

const runPatch = z.object({
  status: z.enum(["queued", "running", "completed", "skipped", "failed"]).optional(),
  externalRunId: z.string().min(1).optional(),
  inputSummary: z.string().optional(),
  outputSummary: z.string().optional(),
  reason: z.string().optional(),
  errorMessage: z.string().optional(),
  contextSnapshot: z.record(z.string(), z.unknown()).optional(),
  startedAt: z.coerce.date().optional(),
  finishedAt: z.coerce.date().optional(),
});

router.patch("/runs/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid_id", message: "run id must be an integer" });
    return;
  }
  const b = runPatch.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "invalid_body", message: b.error.issues[0]?.message });
    return;
  }
  const v = b.data;
  const set: Record<string, unknown> = { ...v };

  // Convenience timestamps if the caller didn't set them explicitly.
  if (v.status === "running" && !v.startedAt) set.startedAt = new Date();
  if ((v.status === "completed" || v.status === "failed" || v.status === "skipped") && !v.finishedAt) {
    set.finishedAt = new Date();
  }

  const [updated] = await db
    .update(agentRunsTable)
    .set(set)
    .where(eq(agentRunsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "not_found", message: "no run with that id" });
    return;
  }
  res.json({ run: updated });
});

/* ───────────────────────── POST /prospect-insights & /rep-insights ───────────────────────── */

const insightBodyBase = {
  type: z.string().min(1),
  title: z.string().optional(),
  summary: z.string().optional(),
  score: z.number().min(0).max(1).optional(),
  status: z.enum(["active", "superseded", "dismissed"]).optional(),
  dedupeKey: z.string().min(1).optional(),
  sourceRunId: z.number().int().optional(),
  sourceEventId: z.string().min(1).optional(),
  sourceVisitId: z.number().int().optional(),
  sourceMediaId: z.number().int().optional(),
  expiresAt: z.coerce.date().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
};
const prospectInsightBody = z.object({ businessId: z.number().int(), ...insightBodyBase });
const repInsightBody = z.object({ repId: z.number().int(), ...insightBodyBase });

/** Shared upsert: dedupeKey wins; else the composite (businessId|repId, type) unique key. */
async function upsertInsight(
  res: import("express").Response,
  scope: { businessId: number; repId: null } | { businessId: null; repId: number },
  v: z.infer<typeof prospectInsightBody> | z.infer<typeof repInsightBody>,
) {
  const now = new Date();
  const values = {
    businessId: scope.businessId,
    repId: scope.repId,
    type: v.type,
    title: v.title ?? null,
    summary: v.summary ?? null,
    score: v.score ?? null,
    status: v.status ?? "active",
    dedupeKey: v.dedupeKey ?? null,
    sourceRunId: v.sourceRunId ?? null,
    sourceEventId: v.sourceEventId ?? null,
    sourceVisitId: v.sourceVisitId ?? null,
    sourceMediaId: v.sourceMediaId ?? null,
    expiresAt: v.expiresAt ?? null,
    metadata: (v.metadata as Record<string, unknown> | undefined) ?? null,
    lastConfirmedAt: now,
  };

  // Find an existing row to update (dedupeKey first, else the scoped composite key).
  let existing: { id: number } | undefined;
  if (v.dedupeKey) {
    [existing] = await db
      .select({ id: insightsTable.id })
      .from(insightsTable)
      .where(eq(insightsTable.dedupeKey, v.dedupeKey))
      .limit(1);
  } else {
    const scopeCond =
      scope.businessId !== null
        ? eq(insightsTable.businessId, scope.businessId)
        : eq(insightsTable.repId, scope.repId as number);
    [existing] = await db
      .select({ id: insightsTable.id })
      .from(insightsTable)
      .where(and(scopeCond, eq(insightsTable.type, v.type)))
      .limit(1);
  }

  if (existing) {
    const [updated] = await db
      .update(insightsTable)
      .set(values)
      .where(eq(insightsTable.id, existing.id))
      .returning();
    res.status(200).json({ insight: updated, upserted: "updated" });
    return;
  }

  const [created] = await db
    .insert(insightsTable)
    .values({ ...values, firstObservedAt: now })
    .returning();
  res.status(201).json({ insight: created, upserted: "created" });
}

router.post("/prospect-insights", async (req, res) => {
  const b = prospectInsightBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "invalid_body", message: b.error.issues[0]?.message });
    return;
  }
  await upsertInsight(res, { businessId: b.data.businessId, repId: null }, b.data);
});

router.post("/rep-insights", async (req, res) => {
  const b = repInsightBody.safeParse(req.body);
  if (!b.success) {
    res.status(400).json({ error: "invalid_body", message: b.error.issues[0]?.message });
    return;
  }
  await upsertInsight(res, { businessId: null, repId: b.data.repId }, b.data);
});

export default router;
