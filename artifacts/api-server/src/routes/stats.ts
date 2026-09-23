import { Router, type IRouter } from "express";
import { eq, sql, gte, and } from "drizzle-orm";
import { db, businessesTable, visitsTable, notesTable, mediaTable } from "@workspace/db";
import { canSeeAllReps } from "../middlewares/clerk-auth";
import {
  GetSummaryStatsResponse,
  GetRecentActivityResponse,
  GetVisitsBySectorResponse,
  GetPipelineStatsResponse,
} from "@workspace/api-zod";
import { buildFollowUpQueue } from "../lib/followups";
import { PIPELINE_STAGES, STAGE_WIN_PROBABILITY, OPEN_STAGES, isPipelineStage } from "../lib/pipeline";

const router: IRouter = Router();

router.get("/stats/summary", async (req, res): Promise<void> => {
  const oneWeekAgo = new Date();
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

  // Reps see only their own stats; leaders/admins/owners see team-wide.
  const repFilter = (!canSeeAllReps(req.userRole) && req.userId)
    ? sql`AND visits.rep_id = ${req.userId}`
    : sql``;

  const [stats] = await db
    .select({
      totalBusinesses: sql<number>`(SELECT COUNT(*) FROM businesses WHERE call_type = 'walk_in')::int`,
      totalVisits: sql<number>`(SELECT COUNT(*) FROM visits WHERE 1=1 ${repFilter})::int`,
      visitsThisWeek: sql<number>`(SELECT COUNT(*) FROM visits WHERE visited_at >= ${oneWeekAgo.toISOString()} ${repFilter})::int`,
      positiveOutcomes: sql<number>`(SELECT COUNT(*) FROM visits WHERE outcome = 'positive' ${repFilter})::int`,
      followUpsNeeded: sql<number>`(SELECT COUNT(*) FROM visits WHERE outcome = 'follow_up_needed' ${repFilter})::int`,
      convertedCount: sql<number>`(SELECT COUNT(*) FROM businesses WHERE status = 'converted' AND call_type = 'walk_in')::int`,
      totalNotes: sql<number>`(SELECT COUNT(*) FROM notes WHERE notes.visit_id IN (SELECT id FROM visits WHERE 1=1 ${repFilter}))::int`,
      totalMedia: sql<number>`(SELECT COUNT(*) FROM media WHERE media.visit_id IN (SELECT id FROM visits WHERE 1=1 ${repFilter}))::int`,
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

router.get("/stats/recent-activity", async (req, res): Promise<void> => {
  const conditions = [];
  if (!canSeeAllReps(req.userRole) && req.userId) {
    conditions.push(eq(visitsTable.repId, req.userId));
  }
  const activity = await db
    .select({
      visitId: visitsTable.id,
      businessId: visitsTable.businessId,
      businessName: businessesTable.name,
      sector: businessesTable.sector,
      outcome: visitsTable.outcome,
      visitedAt: visitsTable.visitedAt,
      repId: visitsTable.repId,
      noteCount: sql<number>`(SELECT COUNT(*) FROM notes WHERE notes.visit_id = ${visitsTable.id})::int`,
      mediaCount: sql<number>`(SELECT COUNT(*) FROM media WHERE media.visit_id = ${visitsTable.id})::int`,
    })
    .from(visitsTable)
    .leftJoin(businessesTable, eq(visitsTable.businessId, businessesTable.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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

// ---------------------------------------------------------------------------
// GET /stats/pipeline — funnel, deal value, win rate, activity, leaderboard.
//
// Prospects are team-shared, so the funnel and win/loss figures are always
// team-wide. Activity figures (visits, contact rate, follow-ups, stale) are
// scoped to the caller unless they can see all reps. The leaderboard is only
// populated for sales leaders and above.
// ---------------------------------------------------------------------------

router.get("/stats/pipeline", async (req, res): Promise<void> => {
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const seeAll = canSeeAllReps(req.userRole);
  const repId = !seeAll && req.userId ? req.userId : undefined;
  const repFilter = repId ? sql`AND visits.rep_id = ${repId}` : sql``;

  // Funnel: count + deal value per stage (walk-in prospects only, like the summary).
  const funnelRows = await db
    .select({
      status: businessesTable.status,
      count: sql<number>`COUNT(*)::int`,
      dealValue: sql<number>`COALESCE(SUM(${businessesTable.dealValue}), 0)::float`,
    })
    .from(businessesTable)
    .where(eq(businessesTable.callType, "walk_in"))
    .groupBy(businessesTable.status);
  const byStatus = new Map(funnelRows.map((r) => [r.status, r]));
  const funnel = PIPELINE_STAGES.map((status) => ({
    status,
    count: byStatus.get(status)?.count ?? 0,
    dealValue: byStatus.get(status)?.dealValue ?? 0,
  }));

  let openPipelineValue = 0;
  let weightedPipelineValue = 0;
  for (const stage of funnel) {
    if (!(OPEN_STAGES as readonly string[]).includes(stage.status)) continue;
    openPipelineValue += stage.dealValue;
    weightedPipelineValue += stage.dealValue * (isPipelineStage(stage.status) ? STAGE_WIN_PROBABILITY[stage.status] : 0);
  }

  const wonCount = byStatus.get("converted")?.count ?? 0;
  const lostCount = byStatus.get("not_interested")?.count ?? 0;
  const winRate = wonCount + lostCount > 0 ? wonCount / (wonCount + lostCount) : null;

  const [closing] = await db
    .select({
      wonThisMonth: sql<number>`(
        SELECT COUNT(*) FROM businesses
        WHERE status = 'converted' AND closed_at >= ${startOfMonth.toISOString()}
      )::int`,
      wonValueThisMonth: sql<number>`(
        SELECT COALESCE(SUM(deal_value), 0) FROM businesses
        WHERE status = 'converted' AND closed_at >= ${startOfMonth.toISOString()}
      )::float`,
      avgDaysToClose: sql<number | null>`(
        SELECT AVG(EXTRACT(EPOCH FROM (b.closed_at - fv.first_visit)) / 86400)::float
        FROM businesses b
        JOIN (
          SELECT business_id, MIN(visited_at) AS first_visit FROM visits GROUP BY business_id
        ) fv ON fv.business_id = b.id
        WHERE b.status = 'converted' AND b.closed_at IS NOT NULL
      )`,
      visitsToday: sql<number>`(
        SELECT COUNT(*) FROM visits WHERE visited_at >= ${startOfToday.toISOString()} ${repFilter}
      )::int`,
      visitsThisWeek: sql<number>`(
        SELECT COUNT(*) FROM visits WHERE visited_at >= ${weekAgo.toISOString()} ${repFilter}
      )::int`,
      contactRate: sql<number | null>`(
        SELECT AVG(CASE WHEN contact_name IS NOT NULL AND contact_name <> '' THEN 1.0 ELSE 0.0 END)::float
        FROM visits WHERE visited_at >= ${weekAgo.toISOString()} ${repFilter}
      )`,
    })
    .from(businessesTable)
    .limit(1);

  const queue = await buildFollowUpQueue({ repId, now });
  const followUpsDue = queue.counts.overdue + queue.counts.today;
  const staleLeads = queue.counts.stale;

  let leaderboard: Array<{
    repId: string;
    visitsThisWeek: number;
    visitsThisMonth: number;
    wonThisMonth: number;
    wonValueThisMonth: number;
    openFollowUps: number;
  }> = [];

  if (seeAll) {
    const activity = await db
      .select({
        repId: visitsTable.repId,
        visitsThisWeek: sql<number>`COUNT(*) FILTER (WHERE ${visitsTable.visitedAt} >= ${weekAgo.toISOString()})::int`,
        visitsThisMonth: sql<number>`COUNT(*) FILTER (WHERE ${visitsTable.visitedAt} >= ${startOfMonth.toISOString()})::int`,
      })
      .from(visitsTable)
      .where(sql`${visitsTable.repId} IS NOT NULL AND ${visitsTable.visitedAt} >= ${startOfMonth.toISOString()}`)
      .groupBy(visitsTable.repId);

    // Wins are attributed to the rep who made the most recent visit before close.
    const wins = await db.execute<{ rep_id: string; won: number; value: number }>(sql`
      SELECT lv.rep_id, COUNT(*)::int AS won, COALESCE(SUM(b.deal_value), 0)::float AS value
      FROM businesses b
      JOIN LATERAL (
        SELECT rep_id FROM visits WHERE visits.business_id = b.id ORDER BY visited_at DESC LIMIT 1
      ) lv ON true
      WHERE b.status = 'converted' AND b.closed_at >= ${startOfMonth.toISOString()} AND lv.rep_id IS NOT NULL
      GROUP BY lv.rep_id
    `);
    const winRows = wins.rows;

    const openByRep = new Map<string, number>();
    for (const item of [...queue.overdue, ...queue.today]) {
      if (item.repId) openByRep.set(item.repId, (openByRep.get(item.repId) ?? 0) + 1);
    }

    const reps = new Map<string, (typeof leaderboard)[number]>();
    const ensure = (id: string) => {
      let r = reps.get(id);
      if (!r) {
        r = { repId: id, visitsThisWeek: 0, visitsThisMonth: 0, wonThisMonth: 0, wonValueThisMonth: 0, openFollowUps: 0 };
        reps.set(id, r);
      }
      return r;
    };
    for (const a of activity) {
      if (!a.repId) continue;
      const r = ensure(a.repId);
      r.visitsThisWeek = a.visitsThisWeek;
      r.visitsThisMonth = a.visitsThisMonth;
    }
    for (const w of winRows) {
      const r = ensure(w.rep_id);
      r.wonThisMonth = Number(w.won);
      r.wonValueThisMonth = Number(w.value);
    }
    for (const [id, n] of openByRep) ensure(id).openFollowUps = n;

    leaderboard = [...reps.values()].sort(
      (a, b) => b.wonThisMonth - a.wonThisMonth || b.visitsThisWeek - a.visitsThisWeek || a.repId.localeCompare(b.repId),
    );
  }

  res.json(
    GetPipelineStatsResponse.parse({
      funnel,
      openPipelineValue,
      weightedPipelineValue,
      wonCount,
      lostCount,
      winRate,
      wonThisMonth: closing?.wonThisMonth ?? 0,
      wonValueThisMonth: closing?.wonValueThisMonth ?? 0,
      avgDaysToClose: closing?.avgDaysToClose ?? null,
      visitsToday: closing?.visitsToday ?? 0,
      visitsThisWeek: closing?.visitsThisWeek ?? 0,
      contactRate: closing?.contactRate ?? null,
      followUpsDue,
      staleLeads,
      leaderboard,
    }),
  );
});

export default router;
