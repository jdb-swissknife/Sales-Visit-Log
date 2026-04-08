import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, businessesTable } from "@workspace/db";
import {
  ListBusinessesResponse,
  CreateBusinessBody,
  GetBusinessParams,
  GetBusinessResponse,
  UpdateBusinessParams,
  UpdateBusinessBody,
  UpdateBusinessResponse,
  DeleteBusinessParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

function sanitizeBusiness(b: typeof businessesTable.$inferSelect) {
  return {
    ...b,
    routeDay: b.routeDay ?? undefined,
    buildingGroup: b.buildingGroup ?? undefined,
    notes: b.notes ?? undefined,
    address: b.address ?? undefined,
    phone: b.phone ?? undefined,
    mapsUrl: b.mapsUrl ?? undefined,
  };
}

router.get("/businesses", async (_req, res): Promise<void> => {
  const businesses = await db
    .select()
    .from(businessesTable)
    .orderBy(businessesTable.createdAt);
  res.json(ListBusinessesResponse.parse(businesses.map(sanitizeBusiness)));
});

router.post("/businesses", async (req, res): Promise<void> => {
  const parsed = CreateBusinessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [business] = await db
    .insert(businessesTable)
    .values(parsed.data)
    .returning();
  res.status(201).json(GetBusinessResponse.parse(sanitizeBusiness(business)));
});

router.get("/businesses/:id", async (req, res): Promise<void> => {
  const params = GetBusinessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [business] = await db
    .select()
    .from(businessesTable)
    .where(eq(businessesTable.id, params.data.id));
  if (!business) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  res.json(GetBusinessResponse.parse(sanitizeBusiness(business)));
});

router.put("/businesses/:id", async (req, res): Promise<void> => {
  const params = UpdateBusinessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const parsed = UpdateBusinessBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [business] = await db
    .update(businessesTable)
    .set({ ...parsed.data, updatedAt: new Date() })
    .where(eq(businessesTable.id, params.data.id))
    .returning();
  if (!business) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  res.json(UpdateBusinessResponse.parse(sanitizeBusiness(business)));
});

router.delete("/businesses/:id", async (req, res): Promise<void> => {
  const params = DeleteBusinessParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [deleted] = await db
    .delete(businessesTable)
    .where(eq(businessesTable.id, params.data.id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Business not found" });
    return;
  }
  res.sendStatus(204);
});

export default router;
