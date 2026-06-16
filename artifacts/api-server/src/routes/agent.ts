import { Router, type IRouter } from "express";
import { desc, gt, gte, like, and, isNotNull, eq, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  eventsTable,
  businessesTable,
  visitsTable,
  agentSuggestionsTable,
  agentRunsTable,
  prospectInsightsTable,
  repInsightsTable,
} from "@workspace/db";
import { ListEventsQueryParams, ListEventsResponse } from "@workspace/api-zod";
import { requireAgentKey } from "../middlewares/agent-auth";
import { suggestionBus } from "../lib/suggestion-bus";
import { logEvent } from "../lib/events";

/**
 * Agent-facing surface for Hermes. Everything here requires
 * `Authorization: Bearer <AGENT_API_KEY>`.
 *
 *   GET   /api/agent/events             — activity feed (same filters as /api/events)
 *   GET   /api/agent/context            — businesses + upcoming callbacks snapshot
 *   POST  /api/agent/suggestions        — push a suggestion (dedupeKey ⇒ upsert)
 *   PATCH /api/agent/runs/:id           — report run lifecycle status
 *   POST  /api/agent/prospect-insights  — upsert insight by (businessId, type)
 *   POST  /api/agent/rep-insights       — upsert insight by (repId, type)
 *
 * Hermes is advisory only: nothing written here triggers app-side automation.
 */
const router: IRouter = Router();

router.use("/agent", requireAgentKey);

router.get("/agent/events", async (req, res): Promise<void> => {
  const query = ListEventsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions: SQL[] = [];
  if (query.data.since) conditions.push(gt(eventsTable.createdAt, new Date(query.data.since)));
  if (query.data.type) conditions.push(like(eventsTable.type, `${query.data.type}%`));

  const limit = Math.min(query.data.limit ?? 100, 500);

  const events = await db
    .select()
    .from(eventsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(eventsTable.createdAt))
    .limit(limit);

  res.json(ListEventsResponse.parse(events));
});

router.get("/agent/context", async (_req, res): Promise<void> => {
  const [businesses, callbacks] = await Promise.all([
    db
      .select({
        id: businessesTable.id,
        name: businessesTable.name,
        address: businessesTable.address,
        sector: businessesTable.sector,
        status: businessesTable.status,
        priority: businessesTable.priority,
        latitude: businessesTable.latitude,
        longitude: businessesTable.longitude,
      })
      .from(businessesTable),
    db
      .select({
        visitId: visitsTable.id,
        businessId: visitsTable.businessId,
        businessName: businessesTable.name,
        outcome: visitsTable.outcome,
        nextActionDate: visitsTable.nextActionDate,
        contactName: visitsTable.contactName,
      })
      .from(visitsTable)
      .leftJoin(businessesTable, eq(visitsTable.businessId, businessesTable.id))
      .where(
        and(
          isNotNull(visitsTable.nextActionDate),
          gte(visitsTable.nextActionDate, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
        ),
      )
      .orderBy(visitsTable.nextActionDate),
  ]);

  res.json({ businesses, upcomingCallbacks: callbacks, generatedAt: new Date().toISOString() });
});

// ---------------------------------------------------------------------------
// Suggestions (write)
// ---------------------------------------------------------------------------

const CreateSuggestionBody = z.object({
  externalId: z.string().max(200).optional(),
  agentRunId: z.number().int().positive().optional(),
  type: z
    .enum(["callback_reminder", "nearby_prospect", "coaching", "debrief", "other"])
    .default("other"),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(5000),
  businessId: z.number().int().positive().optional(),
  repId: z.string().max(200).optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).default("normal"),
  priorityScore: z.number().min(0).max(1).optional(),
  dedupeKey: z.string().max(300).optional(),
  actionLabel: z.string().max(100).optional(),
  actionUrl: z.string().max(1000).optional(),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

router.post("/agent/suggestions", async (req, res): Promise<void> => {
  const parsed = CreateSuggestionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;

  const values = {
    externalId: b.externalId ?? null,
    agentRunId: b.agentRunId ?? null,
    type: b.type,
    title: b.title,
    body: b.body,
    businessId: b.businessId ?? null,
    repId: b.repId ?? null,
    priority: b.priority,
    priorityScore: b.priorityScore ?? null,
    dedupeKey: b.dedupeKey ?? null,
    actionLabel: b.actionLabel ?? null,
    actionUrl: b.actionUrl ?? null,
    expiresAt: b.expiresAt ? new Date(b.expiresAt) : null,
    data: b.data ?? null,
    source: "hermes",
  };

  let suggestion;
  let deduped = false;

  if (b.dedupeKey) {
    // Upsert: same dedupeKey refreshes the existing card instead of stacking
    // duplicates in the rep's feed. Status intentionally left untouched.
    const [row] = await db
      .insert(agentSuggestionsTable)
      .values(values)
      .onConflictDoUpdate({
        target: agentSuggestionsTable.dedupeKey,
        set: {
          externalId: values.externalId,
          agentRunId: values.agentRunId,
          type: values.type,
          title: values.title,
          body: values.body,
          businessId: values.businessId,
          repId: values.repId,
          priority: values.priority,
          priorityScore: values.priorityScore,
          actionLabel: values.actionLabel,
          actionUrl: values.actionUrl,
          expiresAt: values.expiresAt,
          data: values.data,
        },
      })
      .returning();
    suggestion = row;
    deduped = (suggestion.createdAt?.getTime() ?? 0) < Date.now() - 2000;
  } else {
    const [row] = await db.insert(agentSuggestionsTable).values(values).returning();
    suggestion = row;
  }

  suggestionBus.publish(suggestion);

  if (!deduped) {
    void logEvent({
      type: "suggestion.created",
      entityType: "suggestion",
      entityId: suggestion.id,
      businessId: suggestion.businessId,
      payload: { suggestionType: suggestion.type, title: suggestion.title },
    });
  }

  res.status(deduped ? 200 : 201).json(suggestion);
});

// ---------------------------------------------------------------------------
// Agent run lifecycle
// ---------------------------------------------------------------------------

const RunParams = z.object({ id: z.coerce.number().int().positive() });
const PatchRunBody = z.object({
  status: z.enum(["queued", "running", "completed", "failed", "skipped"]),
  externalRunId: z.string().max(200).optional(),
  error: z.string().max(5000).optional(),
  output: z.record(z.string(), z.unknown()).optional(),
});

router.patch("/agent/runs/:id", async (req, res): Promise<void> => {
  const params = RunParams.safeParse(req.params);
  const body = PatchRunBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.success ? body : params).error?.message });
    return;
  }

  const now = new Date();
  const set: Record<string, unknown> = { status: body.data.status };
  if (body.data.externalRunId !== undefined) set.externalRunId = body.data.externalRunId;
  if (body.data.error !== undefined) set.error = body.data.error;
  if (body.data.output !== undefined) set.output = body.data.output;
  if (body.data.status === "running") set.startedAt = now;
  if (["completed", "failed", "skipped"].includes(body.data.status)) set.finishedAt = now;

  const [updated] = await db
    .update(agentRunsTable)
    .set(set)
    .where(eq(agentRunsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Agent run not found" });
    return;
  }
  res.json(updated);
});

// ---------------------------------------------------------------------------
// Insights (advisory persistence; upserts are idempotent)
// ---------------------------------------------------------------------------

const ProspectInsightBody = z.object({
  businessId: z.number().int().positive(),
  agentRunId: z.number().int().positive().optional(),
  type: z.string().min(1).max(100),
  summary: z.string().min(1).max(5000),
  score: z.number().min(0).max(1).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

router.post("/agent/prospect-insights", async (req, res): Promise<void> => {
  const parsed = ProspectInsightBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const [row] = await db
    .insert(prospectInsightsTable)
    .values({
      businessId: b.businessId,
      agentRunId: b.agentRunId ?? null,
      type: b.type,
      summary: b.summary,
      score: b.score ?? null,
      data: b.data ?? null,
    })
    .onConflictDoUpdate({
      target: [prospectInsightsTable.businessId, prospectInsightsTable.type],
      set: {
        agentRunId: b.agentRunId ?? null,
        summary: b.summary,
        score: b.score ?? null,
        data: b.data ?? null,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  res.status(200).json(row);
});

const RepInsightBody = z.object({
  repId: z.string().min(1).max(200),
  agentRunId: z.number().int().positive().optional(),
  type: z.string().min(1).max(100),
  summary: z.string().min(1).max(5000),
  score: z.number().min(0).max(1).optional(),
  periodStart: z.iso.datetime({ offset: true }).optional(),
  periodEnd: z.iso.datetime({ offset: true }).optional(),
  data: z.record(z.string(), z.unknown()).optional(),
});

router.post("/agent/rep-insights", async (req, res): Promise<void> => {
  const parsed = RepInsightBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const b = parsed.data;
  const [row] = await db
    .insert(repInsightsTable)
    .values({
      repId: b.repId,
      agentRunId: b.agentRunId ?? null,
      type: b.type,
      summary: b.summary,
      score: b.score ?? null,
      periodStart: b.periodStart ? new Date(b.periodStart) : null,
      periodEnd: b.periodEnd ? new Date(b.periodEnd) : null,
      data: b.data ?? null,
    })
    .onConflictDoUpdate({
      target: [repInsightsTable.repId, repInsightsTable.type],
      set: {
        agentRunId: b.agentRunId ?? null,
        summary: b.summary,
        score: b.score ?? null,
        periodStart: b.periodStart ? new Date(b.periodStart) : null,
        periodEnd: b.periodEnd ? new Date(b.periodEnd) : null,
        data: b.data ?? null,
        updatedAt: sql`now()`,
      },
    })
    .returning();
  res.status(200).json(row);
});

export default router;
