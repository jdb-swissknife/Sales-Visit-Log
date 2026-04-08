import { Router, type IRouter } from "express";
import { eq, sql, gte } from "drizzle-orm";
import { db, businessesTable, visitsTable, notesTable, mediaTable } from "@workspace/db";
import {
  GetSummaryStatsResponse,
  GetRecentActivityResponse,
  GetVisitsBySectorResponse,
} from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/stats/summary", async (_req, res): Promise<void> => {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  const [stats] = await db
    .select({
      totalBusinesses: sql<number>`(SELECT COUNT(*) FROM businesses)::int`,
      totalVisits: sql<number>`(SELECT COUNT(*) FROM visits)::int`,
      visitsThisWeek: sql<number>`(SELECT COUNT(*) FROM visits WHERE visited_at >= ${oneWeekAgo.toISOString()})::int`,
      positiveOutcomes: sql<number>`(SELECT COUNT(*) FROM visits WHERE outcome = 'positive')::int`,
      followUpsNeeded: sql<number>`(SELECT COUNT(*) FROM visits WHERE outcome = 'follow_up_needed')::int`,
      convertedCount: sql<number>`(SELECT COUNT(*) FROM businesses WHERE status = 'converted')::int`,
      totalNotes: sql<number>`(SELECT COUNT(*) FROM notes)::int`,
      totalMedia: sql<number>`(SELECT COUNT(*) FROM media)::int`,
    })
    .from(businessesTable)
    .limit(1);

  res.json(
    GetSummaryStatsResponse.parse(
      stats ?? {
        totalBusinesses: 0,
        totalVisits: 0,
        visitsThisWeek: 0,
        positiveOutcomes: 0,
        followUpsNeeded: 0,
        convertedCount: 0,
        totalNotes: 0,
        totalMedia: 0,
      }
    )
  );
});

router.get("/stats/recent-activity", async (_req, res): Promise<void> => {
  const activity = await db
    .select({
      visitId: visitsTable.id,
      businessId: visitsTable.businessId,
      businessName: businessesTable.name,
      sector: businessesTable.sector,
      outcome: visitsTable.outcome,
      visitedAt: visitsTable.visitedAt,
      noteCount: sql<number>`(SELECT COUNT(*) FROM notes WHERE notes.visit_id = ${visitsTable.id})::int`,
      mediaCount: sql<number>`(SELECT COUNT(*) FROM media WHERE media.visit_id = ${visitsTable.id})::int`,
    })
    .from(visitsTable)
    .leftJoin(businessesTable, eq(visitsTable.businessId, businessesTable.id))
    .orderBy(sql`${visitsTable.visitedAt} DESC`)
    .limit(20);
  res.json(GetRecentActivityResponse.parse(activity));
});

router.get("/stats/by-sector", async (_req, res): Promise<void> => {
  const sectors = await db
    .select({
      sector: businessesTable.sector,
      count: sql<number>`COUNT(DISTINCT ${visitsTable.id})::int`,
      positiveCount: sql<number>`COUNT(DISTINCT CASE WHEN ${visitsTable.outcome} = 'positive' THEN ${visitsTable.id} END)::int`,
    })
    .from(businessesTable)
    .leftJoin(visitsTable, eq(visitsTable.businessId, businessesTable.id))
    .groupBy(businessesTable.sector)
    .orderBy(sql`COUNT(DISTINCT ${visitsTable.id}) DESC`);
  res.json(GetVisitsBySectorResponse.parse(sectors));
});

export default router;
