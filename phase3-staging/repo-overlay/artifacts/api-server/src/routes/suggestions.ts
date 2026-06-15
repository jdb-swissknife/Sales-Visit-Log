/**
 * App-facing suggestions feed (R3).
 *
 *   GET    /api/suggestions            list (filters: status, businessId, limit)
 *   PATCH  /api/suggestions/:id        lifecycle transition (read | acted | dismissed)
 *   GET    /api/suggestions/stream     SSE live feed (via suggestion-bus)
 *
 * App-facing → NOT behind requireAgentKey (scoped by the app's own auth, per plan).
 *
 * ── ASSUMPTIONS to confirm at activation ─────────────────────────────────────
 *  A1. `db` (drizzle client) and `agentSuggestionsTable` are exported from
 *      "@workspace/db". If the client lives elsewhere (e.g. "@workspace/db/client"),
 *      fix the two imports below.
 *  A2. Drizzle pg-core dialect (onConflict / returning available). Confirmed by R1.
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, desc, eq } from "drizzle-orm";
import { db, agentSuggestionsTable } from "@workspace/db";
import { suggestionBus } from "../lib/suggestion-bus";

const router: IRouter = Router();

const VALID_STATUS = ["unread", "read", "acted", "dismissed"] as const;

/** Map a PATCH transition to the column that records its timestamp. */
const STATUS_TIMESTAMP: Record<string, "readAt" | "actedAt" | "dismissedAt" | null> = {
  read: "readAt",
  acted: "actedAt",
  dismissed: "dismissedAt",
  unread: null,
};

const listQuery = z.object({
  status: z.enum(VALID_STATUS).optional(),
  businessId: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

// GET /api/suggestions
router.get("/", async (req, res) => {
  const q = listQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "invalid_query", message: q.error.issues[0]?.message });
    return;
  }
  const { status, businessId, limit } = q.data;

  const conditions = [];
  if (status) conditions.push(eq(agentSuggestionsTable.status, status));
  if (businessId !== undefined) conditions.push(eq(agentSuggestionsTable.businessId, businessId));

  const rows = await db
    .select()
    .from(agentSuggestionsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(agentSuggestionsTable.createdAt))
    .limit(limit);

  res.json({ suggestions: rows });
});

const patchBody = z.object({
  // accept either {status} or a bare action; normalize to a status
  status: z.enum(["read", "acted", "dismissed"]),
});

// PATCH /api/suggestions/:id
router.patch("/:id", async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "invalid_id", message: "suggestion id must be an integer" });
    return;
  }
  const body = patchBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "invalid_body", message: body.error.issues[0]?.message });
    return;
  }

  const { status } = body.data;
  const tsCol = STATUS_TIMESTAMP[status];
  const set: Record<string, unknown> = { status };
  if (tsCol) set[tsCol] = new Date();

  const [updated] = await db
    .update(agentSuggestionsTable)
    .set(set)
    .where(eq(agentSuggestionsTable.id, id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "not_found", message: "no suggestion with that id" });
    return;
  }

  suggestionBus.publish({ type: "updated", suggestion: updated });
  res.json({ suggestion: updated });
});

// GET /api/suggestions/stream  (Server-Sent Events)
router.get("/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable proxy buffering
  // @ts-expect-error flushHeaders exists on the Node response
  res.flushHeaders?.();

  res.write(`event: ready\ndata: {}\n\n`);

  const unsubscribe = suggestionBus.subscribe((evt) => {
    res.write(`event: ${evt.type}\n`);
    res.write(`data: ${JSON.stringify(evt.suggestion)}\n\n`);
  });

  // periodic comment keeps the connection alive through idle proxies
  const keepAlive = setInterval(() => res.write(`: keep-alive\n\n`), 25_000);

  req.on("close", () => {
    clearInterval(keepAlive);
    unsubscribe();
    res.end();
  });
});

export default router;
