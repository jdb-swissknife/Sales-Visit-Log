import { Router, type IRouter } from "express";
import { desc, gt, like, and, type SQL } from "drizzle-orm";
import { db, eventsTable } from "@workspace/db";
import {
  ListEventsQueryParams,
  ListEventsResponse,
  CreateEventBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/events", async (req, res): Promise<void> => {
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

router.post("/events", async (req, res): Promise<void> => {
  const parsed = CreateEventBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [event] = await db
    .insert(eventsTable)
    .values({
      type: parsed.data.type,
      entityType: parsed.data.entityType ?? null,
      entityId: parsed.data.entityId ?? null,
      businessId: parsed.data.businessId ?? null,
      visitId: parsed.data.visitId ?? null,
      payload: parsed.data.payload ?? null,
      source: "client",
    })
    .returning();
  res.status(201).json(event);
});

export default router;
