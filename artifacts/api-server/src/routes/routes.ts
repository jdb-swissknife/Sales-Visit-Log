import { Router, type IRouter } from "express";
import { eq, sql, asc, desc } from "drizzle-orm";
import { db, businessesTable, visitsTable, notesTable } from "@workspace/db";
import { GetRoutesByDayResponse } from "@workspace/api-zod";

const router: IRouter = Router();

const DAY_META = [
  { dayNumber: 1, areaName: "North", neighborhoods: "Brooklyn Center · Columbia Heights · NE Minneapolis" },
  { dayNumber: 2, areaName: "South", neighborhoods: "Nokomis · Richfield · South Minneapolis" },
  { dayNumber: 3, areaName: "Bloomington", neighborhoods: "I-494 Corridor · Lyndale Ave South" },
  { dayNumber: 4, areaName: "West", neighborhoods: "St. Louis Park · Spring Lake Park" },
];

router.get("/routes/by-day", async (_req, res): Promise<void> => {
  const businesses = await db
    .select({
      id: businessesTable.id,
      name: businessesTable.name,
      address: businessesTable.address,
      phone: businessesTable.phone,
      sector: businessesTable.sector,
      rating: businessesTable.rating,
      reviewCount: businessesTable.reviewCount,
      mapsUrl: businessesTable.mapsUrl,
      latitude: businessesTable.latitude,
      longitude: businessesTable.longitude,
      priority: businessesTable.priority,
      status: businessesTable.status,
      routeDay: businessesTable.routeDay,
      isBonus: businessesTable.isBonus,
      buildingGroup: businessesTable.buildingGroup,
      yearBuilt: businessesTable.yearBuilt,
      lastHvacPermitYear: businessesTable.lastHvacPermitYear,
      ownerOccupied: businessesTable.ownerOccupied,
      livingAreaSqft: businessesTable.livingAreaSqft,
      amiBand: businessesTable.amiBand,
      utilityProvider: businessesTable.utilityProvider,
      subdivision: businessesTable.subdivision,
      neighborhood: businessesTable.neighborhood,
      replacementScore: businessesTable.replacementScore,
      priorityGrade: businessesTable.priorityGrade,
      scoreReasons: businessesTable.scoreReasons,
      recommendedPitch: businessesTable.recommendedPitch,
      clusterKey: businessesTable.clusterKey,
      noteCount: sql<number>`(
        SELECT COUNT(*) FROM notes
        WHERE notes.visit_id IN (
          SELECT id FROM visits WHERE visits.business_id = ${businessesTable.id}
        )
      )::int`,
      visitCount: sql<number>`(
        SELECT COUNT(*) FROM visits WHERE visits.business_id = ${businessesTable.id}
      )::int`,
      lastOutcome: sql<string | null>`(
        SELECT outcome FROM visits
        WHERE visits.business_id = ${businessesTable.id}
        ORDER BY visited_at DESC
        LIMIT 1
      )`,
    })
    .from(businessesTable)
    .where(sql`${businessesTable.routeDay} IS NOT NULL`)
    .orderBy(
      asc(businessesTable.routeDay),
      asc(businessesTable.isBonus),
      desc(sql`CASE ${businessesTable.priority} WHEN 'high' THEN 3 WHEN 'medium' THEN 2 ELSE 1 END`)
    );

  const days = DAY_META.map((meta) => {
    const stops = businesses
      .filter((b) => b.routeDay === meta.dayNumber)
      .map((b) => ({
        ...b,
        buildingGroup: b.buildingGroup ?? b.clusterKey ?? undefined,
        yearBuilt: b.yearBuilt ?? undefined,
        lastHvacPermitYear: b.lastHvacPermitYear ?? undefined,
        ownerOccupied: b.ownerOccupied ?? undefined,
        livingAreaSqft: b.livingAreaSqft ?? undefined,
        amiBand: b.amiBand ?? undefined,
        utilityProvider: b.utilityProvider ?? undefined,
        subdivision: b.subdivision ?? undefined,
        neighborhood: b.neighborhood ?? undefined,
        replacementScore: b.replacementScore ?? undefined,
        priorityGrade: b.priorityGrade ?? undefined,
        scoreReasons: b.scoreReasons ?? undefined,
        recommendedPitch: b.recommendedPitch ?? undefined,
        clusterKey: b.clusterKey ?? undefined,
        latitude: b.latitude ?? undefined,
        longitude: b.longitude ?? undefined,
        lastOutcome: b.lastOutcome ?? undefined,
      }));
    return {
      dayNumber: meta.dayNumber,
      areaName: meta.areaName,
      neighborhoods: meta.neighborhoods,
      stops,
    };
  });

  res.json(GetRoutesByDayResponse.parse(days));
});

export default router;
