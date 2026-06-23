import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, businessesTable, visitsTable } from "@workspace/db";
import { geocodeAddress } from "../lib/geocode";
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

/** Geocode in the background and store coordinates; never blocks the response. */
function geocodeInBackground(businessId: number, address: string): void {
  void geocodeAddress(address)
    .then(async (point) => {
      if (!point) return;
      await db
        .update(businessesTable)
        .set({ latitude: point.latitude, longitude: point.longitude, geocodedAt: new Date() })
        .where(eq(businessesTable.id, businessId));
    })
    .catch(() => {});
}

/** Generic sanitizer that converts nulls to undefined for optional fields. */
function sanitizeBusiness(b: Record<string, unknown>): Record<string, unknown> {
  const result = { ...b };
  for (const key of ["routeDay", "buildingGroup", "notes", "address", "phone", "website", "mapsUrl", "latitude", "longitude", "geocodedAt", "lastVisitRepId", "lastVisitAt", "lastVisitOutcome"]) {
    if (result[key] == null) (result as Record<string, unknown>)[key] = undefined;
  }
  return result;
}

// ---------------------------------------------------------------------------
// GET /businesses — team-readable (all authenticated users see all prospects)
// Includes last-visit coordination info (who/when) to prevent duplicate visits.
// ---------------------------------------------------------------------------

router.get("/businesses", async (req, res): Promise<void> => {
  const callType = typeof req.query.callType === "string" ? req.query.callType : undefined;
  const query = db
    .select({
      id: businessesTable.id,
      name: businessesTable.name,
      address: businessesTable.address,
      phone: businessesTable.phone,
      website: businessesTable.website,
      sector: businessesTable.sector,
      rating: businessesTable.rating,
      reviewCount: businessesTable.reviewCount,
      notes: businessesTable.notes,
      mapsUrl: businessesTable.mapsUrl,
      priority: businessesTable.priority,
      status: businessesTable.status,
      callType: businessesTable.callType,
      routeDay: businessesTable.routeDay,
      isBonus: businessesTable.isBonus,
      buildingGroup: businessesTable.buildingGroup,
      latitude: businessesTable.latitude,
      longitude: businessesTable.longitude,
      geocodedAt: businessesTable.geocodedAt,
      createdAt: businessesTable.createdAt,
      updatedAt: businessesTable.updatedAt,
      // Last visit coordination info: who visited and when (team-visible).
      lastVisitRepId: sql<string | null>`(
        SELECT rep_id FROM visits
        WHERE visits.business_id = ${businessesTable.id}
        ORDER BY visited_at DESC LIMIT 1
      )`,
      lastVisitAt: sql<string | null>`(
        SELECT visited_at::text FROM visits
        WHERE visits.business_id = ${businessesTable.id}
        ORDER BY visited_at DESC LIMIT 1
      )`,
      lastVisitOutcome: sql<string | null>`(
        SELECT outcome FROM visits
        WHERE visits.business_id = ${businessesTable.id}
        ORDER BY visited_at DESC LIMIT 1
      )`,
      visitCount: sql<number>`(SELECT COUNT(*) FROM visits WHERE visits.business_id = ${businessesTable.id})::int`,
    })
    .from(businessesTable)
    .$dynamic();
  const businesses = callType
    ? await query.where(eq(businessesTable.callType, callType)).orderBy(businessesTable.createdAt)
    : await query.orderBy(businessesTable.createdAt);
  res.json(businesses.map((b) => sanitizeBusiness(b as Record<string, unknown>)));
});

// ---------------------------------------------------------------------------
// POST /businesses — any authenticated user can add prospects
// ---------------------------------------------------------------------------

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
  if (business.address && business.latitude == null) {
    geocodeInBackground(business.id, business.address);
  }
  res.status(201).json(sanitizeBusiness(business));
});

// ---------------------------------------------------------------------------
// GET /businesses/:id — detail view (team-readable)
// ---------------------------------------------------------------------------

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
  res.json(sanitizeBusiness(business));
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
  if (parsed.data.address && business.address && business.latitude == null) {
    geocodeInBackground(business.id, business.address);
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
