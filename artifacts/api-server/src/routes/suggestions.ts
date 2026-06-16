import { Router, type IRouter } from "express";
import { desc, eq, and, or, isNull, gt, sql, type SQL } from "drizzle-orm";
import { z } from "zod/v4";
import { db, agentSuggestionsTable } from "@workspace/db";
import { suggestionBus } from "../lib/suggestion-bus";
import { logEvent } from "../lib/events";

/**
 * App-facing suggestions feed (what the rep sees).
 *
 *   GET   /api/suggestions          — list (status filter; expired excluded by default)
 *   PATCH /api/suggestions/:id      — unread / read / acted / dismissed
 *   GET   /api/suggestions/stream   — SSE: new suggestions pushed live
 */
const router: IRouter = Router();

const ListQuery = z.object({
  // "new" accepted as a legacy alias for "unread"
  status: z.enum(["unread", "new", "read", "acted", "dismissed"]).optional(),
  includeExpired: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

router.get("/suggestions", async (req, res): Promise<void> => {
  const query = ListQuery.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions: SQL[] = [];
  if (query.data.status) {
    const status = query.data.status === "new" ? "unread" : query.data.status;
    conditions.push(eq(agentSuggestionsTable.status, status));
  }
  if (!query.data.includeExpired) {
    const notExpired = or(
      isNull(agentSuggestionsTable.expiresAt),
      gt(agentSuggestionsTable.expiresAt, new Date()),
    );
    if (notExpired) conditions.push(notExpired);
  }

  const suggestions = await db
    .select()
    .from(agentSuggestionsTable)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(agentSuggestionsTable.createdAt))
    .limit(query.data.limit ?? 50);

  res.json(suggestions);
});

router.get("/suggestions/stream", (req, res): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write(": connected\n\n");

  const unsubscribe = suggestionBus.subscribe((suggestion) => {
    res.write(`event: suggestion\ndata: ${JSON.stringify(suggestion)}\n\n`);
  });

  const heartbeat = setInterval(() => {
    res.write(": ping\n\n");
  }, 25_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

const PatchParams = z.object({ id: z.coerce.number().int().positive() });
const PatchBody = z.object({ status: z.enum(["unread", "read", "acted", "dismissed"]) });

router.patch("/suggestions/:id", async (req, res): Promise<void> => {
  const params = PatchParams.safeParse(req.params);
  const body = PatchBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: (params.success ? body : params).error?.message });
    return;
  }

  const status = body.data.status;
  const now = new Date();
  const set: Record<string, unknown> = { status };

  // Lifecycle timestamps:
  //   read      → readAt (first time)
  //   acted     → actedAt, plus readAt if it was never read
  //   dismissed → dismissedAt
  //   unread    → clears all three (a deliberate "mark unread")
  if (status === "read") {
    set.readAt = sql`COALESCE(${agentSuggestionsTable.readAt}, ${now})`;
  } else if (status === "acted") {
    set.actedAt = now;
    set.readAt = sql`COALESCE(${agentSuggestionsTable.readAt}, ${now})`;
  } else if (status === "dismissed") {
    set.dismissedAt = now;
  } else if (status === "unread") {
    set.readAt = null;
    set.actedAt = null;
    set.dismissedAt = null;
  }

  const [updated] = await db
    .update(agentSuggestionsTable)
    .set(set)
    .where(eq(agentSuggestionsTable.id, params.data.id))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Suggestion not found" });
    return;
  }

  void logEvent({
    type: `suggestion.${status}`,
    entityType: "suggestion",
    entityId: updated.id,
    businessId: updated.businessId,
    payload: { suggestionType: updated.type },
  });

  res.json(updated);
});

export default router;
