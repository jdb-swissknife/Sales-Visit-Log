import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, visitsTable, businessesTable, notesTable, mediaTable } from "@workspace/db";
import { logEvent } from "../lib/events";
import {
  ListVisitsResponse,
  ListVisitsForBusinessParams,
  ListVisitsForBusinessResponse,
  CreateVisitBody,
  GetVisitParams,
  GetVisitResponse,
  UpdateVisitParams,
  UpdateVisitBody,
  UpdateVisitResponse,
  DeleteVisitParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/visits", async (_req, res): Promise<void> => {
  const visits = await db
    .select({
      id: visitsTable.id,
      businessId: visitsTable.businessId,
      businessName: businessesTable.name,
      visitedAt: visitsTable.visitedAt,
      outcome: visitsTable.outcome,
      contactName: visitsTable.contactName,
      contactPhone: visitsTable.contactPhone,
      nextActionDate: visitsTable.nextActionDate,
      createdAt: visitsTable.createdAt,
      noteCount: sql<number>`(SELECT COUNT(*) FROM notes WHERE notes.visit_id = ${visitsTable.id})::int`,
      mediaCount: sql<number>`(SELECT COUNT(*) FROM media WHERE media.visit_id = ${visitsTable.id})::int`,
    })
    .from(visitsTable)
    .leftJoin(businessesTable, eq(visitsTable.businessId, businessesTable.id))
    .orderBy(sql`${visitsTable.visitedAt} DESC`);
  res.json(ListVisitsResponse.parse(visits));
});

router.get("/businesses/:id/visits", async (req, res): Promise<void> => {
  const params = ListVisitsForBusinessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const visits = await db
    .select({
      id: visitsTable.id,
      businessId: visitsTable.businessId,
      businessName: businessesTable.name,
      visitedAt: visitsTable.visitedAt,
      outcome: visitsTable.outcome,
      contactName: visitsTable.contactName,
      contactPhone: visitsTable.contactPhone,
      nextActionDate: visitsTable.nextActionDate,
      createdAt: visitsTable.createdAt,
      noteCount: sql<number>`(SELECT COUNT(*) FROM notes WHERE notes.visit_id = ${visitsTable.id})::int`,
      mediaCount: sql<number>`(SELECT COUNT(*) FROM media WHERE media.visit_id = ${visitsTable.id})::int`,
    })
    .from(visitsTable)
    .leftJoin(businessesTable, eq(visitsTable.businessId, businessesTable.id))
    .where(eq(visitsTable.businessId, params.data.id))
    .orderBy(sql`${visitsTable.visitedAt} DESC`);
  res.json(ListVisitsForBusinessResponse.parse(visits));
});

router.post("/visits", async (req, res): Promise<void> => {
  const parsed = CreateVisitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [visit] = await db
    .insert(visitsTable)
    .values(parsed.data)
    .returning();
  const business = await db
    .select({ name: businessesTable.name })
    .from(businessesTable)
    .where(eq(businessesTable.id, visit.businessId));

  await db
    .update(businessesTable)
    .set({ status: "contacted", updatedAt: new Date() })
    .where(eq(businessesTable.id, visit.businessId));

  void logEvent({
    type: "visit.created",
    entityType: "visit",
    entityId: visit.id,
    businessId: visit.businessId,
    visitId: visit.id,
    payload: { outcome: visit.outcome, businessName: business[0]?.name },
  });

  res.status(201).json(
    GetVisitResponse.parse({
      ...visit,
      businessName: business[0]?.name ?? null,
      noteCount: 0,
      mediaCount: 0,
      notes: [],
      media: [],
    })
  );
});

router.get("/visits/:id", async (req, res): Promise<void> => {
  const params = GetVisitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [visit] = await db
    .select({
      id: visitsTable.id,
      businessId: visitsTable.businessId,
      businessName: businessesTable.name,
      visitedAt: visitsTable.visitedAt,
      outcome: visitsTable.outcome,
      contactName: visitsTable.contactName,
      contactPhone: visitsTable.contactPhone,
      nextActionDate: visitsTable.nextActionDate,
      createdAt: visitsTable.createdAt,
    })
    .from(visitsTable)
    .leftJoin(businessesTable, eq(visitsTable.businessId, businessesTable.id))
    .where(eq(visitsTable.id, params.data.id));

  if (!visit) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }

  const notes = await db
    .select()
    .from(notesTable)
    .where(eq(notesTable.visitId, params.data.id))
    .orderBy(notesTable.createdAt);

  const media = await db
    .select()
    .from(mediaTable)
    .where(eq(mediaTable.visitId, params.data.id))
    .orderBy(mediaTable.createdAt);

  res.json(
    GetVisitResponse.parse({
      ...visit,
      noteCount: notes.length,
      mediaCount: media.length,
      notes,
      media,
    })
  );
});

router.put("/visits/:id", async (req, res): Promise<void> => {
  const params = UpdateVisitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateVisitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updateData: Partial<typeof visitsTable.$inferInsert> = {};
  if (parsed.data.visitedAt != null) updateData.visitedAt = new Date(parsed.data.visitedAt);
  if (parsed.data.outcome != null) updateData.outcome = parsed.data.outcome;
  if (parsed.data.contactName != null) updateData.contactName = parsed.data.contactName;
  if (parsed.data.contactPhone != null) updateData.contactPhone = parsed.data.contactPhone;
  if (parsed.data.nextActionDate != null) updateData.nextActionDate = new Date(parsed.data.nextActionDate);

  const [updated] = await db
    .update(visitsTable)
    .set(updateData)
    .where(eq(visitsTable.id, params.data.id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }
  const [business] = await db
    .select({ name: businessesTable.name })
    .from(businessesTable)
    .where(eq(businessesTable.id, updated.businessId));

  void logEvent({
    type: "visit.updated",
    entityType: "visit",
    entityId: updated.id,
    businessId: updated.businessId,
    visitId: updated.id,
    payload: { outcome: updated.outcome },
  });

  const noteCountResult = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(notesTable)
    .where(eq(notesTable.visitId, params.data.id));
  const mediaCountResult = await db
    .select({ count: sql<number>`COUNT(*)::int` })
    .from(mediaTable)
    .where(eq(mediaTable.visitId, params.data.id));

  res.json(
    UpdateVisitResponse.parse({
      ...updated,
      businessName: business?.name ?? null,
      noteCount: noteCountResult[0]?.count ?? 0,
      mediaCount: mediaCountResult[0]?.count ?? 0,
    })
  );
});

router.delete("/visits/:id", async (req, res): Promise<void> => {
  const params = DeleteVisitParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(visitsTable)
    .where(eq(visitsTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Visit not found" });
    return;
  }
  void logEvent({
    type: "visit.deleted",
    entityType: "visit",
    entityId: deleted.id,
    businessId: deleted.businessId,
    visitId: deleted.id,
  });
  res.sendStatus(204);
});

export default router;
