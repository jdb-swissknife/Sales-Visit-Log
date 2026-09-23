import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, desc, eq, inArray, like } from "drizzle-orm";

type DbModule = typeof import("@workspace/db");
type StageModule = typeof import("../src/lib/stage");
type FollowUpsModule = typeof import("../src/lib/followups");

const d = process.env.DATABASE_URL ? describe : describe.skip;
const DAY = 86_400_000;

d("follow-up queue + stage transitions (DB)", () => {
  let dbm: DbModule;
  let stage: StageModule;
  let followups: FollowUpsModule;
  const unique = `PIPE-TEST ${Date.now()}`;
  const ids: Record<string, number> = {};
  const REP_A = `rep_a_${Date.now()}`;
  const REP_B = `rep_b_${Date.now()}`;

  const mkBiz = async (name: string, extra: Partial<DbModule["businessesTable"]["$inferInsert"]> = {}): Promise<number> => {
    const [b] = await dbm.db
      .insert(dbm.businessesTable)
      .values({ name: `${unique} ${name}`, sector: "test", ...extra })
      .returning({ id: dbm.businessesTable.id });
    assert.ok(b);
    return b.id;
  };
  const mkVisit = async (v: DbModule["visitsTable"]["$inferInsert"]): Promise<number> => {
    const [row] = await dbm.db.insert(dbm.visitsTable).values(v).returning({ id: dbm.visitsTable.id });
    assert.ok(row);
    return row.id;
  };
  const statusOf = async (id: number) => {
    const [b] = await dbm.db.select().from(dbm.businessesTable).where(eq(dbm.businessesTable.id, id));
    assert.ok(b);
    return b;
  };

  before(async () => {
    [dbm, stage, followups] = await Promise.all([
      import("@workspace/db"),
      import("../src/lib/stage"),
      import("../src/lib/followups"),
    ]);
    const now = Date.now();

    // Rep A: overdue promise, promise today, promise in 3 days, stale (no promise, 20d ago), fresh (5d ago)
    ids.overdue = await mkBiz("overdue", { status: "follow_up", priority: "low", dealValue: 500 });
    await mkVisit({ businessId: ids.overdue, repId: REP_A, outcome: "follow_up_needed", visitedAt: new Date(now - 3 * DAY), nextActionDate: new Date(now - DAY) });

    ids.overdueHigh = await mkBiz("overdue-high", { status: "follow_up", priority: "high", dealValue: 5000 });
    await mkVisit({ businessId: ids.overdueHigh, repId: REP_A, outcome: "follow_up_needed", visitedAt: new Date(now - 3 * DAY), nextActionDate: new Date(now - DAY) });

    ids.today = await mkBiz("today", { status: "contacted" });
    await mkVisit({ businessId: ids.today, repId: REP_A, outcome: "positive", visitedAt: new Date(now - DAY), nextActionDate: new Date(now) });

    ids.upcoming = await mkBiz("upcoming", { status: "proposal_sent" });
    await mkVisit({ businessId: ids.upcoming, repId: REP_A, outcome: "positive", visitedAt: new Date(now - DAY), nextActionDate: new Date(now + 3 * DAY) });

    ids.stale = await mkBiz("stale", { status: "contacted" });
    await mkVisit({ businessId: ids.stale, repId: REP_A, outcome: "neutral", visitedAt: new Date(now - 20 * DAY) });

    ids.fresh = await mkBiz("fresh", { status: "contacted" });
    await mkVisit({ businessId: ids.fresh, repId: REP_A, outcome: "neutral", visitedAt: new Date(now - 5 * DAY) });

    // Superseded promise: an old overdue promise followed by a newer visit with no promise → not overdue
    ids.superseded = await mkBiz("superseded", { status: "contacted" });
    await mkVisit({ businessId: ids.superseded, repId: REP_A, outcome: "follow_up_needed", visitedAt: new Date(now - 10 * DAY), nextActionDate: new Date(now - 5 * DAY) });
    await mkVisit({ businessId: ids.superseded, repId: REP_A, outcome: "neutral", visitedAt: new Date(now - 2 * DAY) });

    // Closed deals never appear even when overdue
    ids.won = await mkBiz("won", { status: "converted", closedAt: new Date(now - DAY) });
    await mkVisit({ businessId: ids.won, repId: REP_A, outcome: "positive", visitedAt: new Date(now - 30 * DAY), nextActionDate: new Date(now - 20 * DAY) });

    // Rep B: one overdue item — must not leak into Rep A's queue
    ids.repB = await mkBiz("repB", { status: "follow_up" });
    await mkVisit({ businessId: ids.repB, repId: REP_B, outcome: "follow_up_needed", visitedAt: new Date(now - 3 * DAY), nextActionDate: new Date(now - DAY) });

    // Never visited → never in the queue
    ids.untouched = await mkBiz("untouched");
  });

  after(async () => {
    const rows = await dbm.db
      .select({ id: dbm.businessesTable.id })
      .from(dbm.businessesTable)
      .where(like(dbm.businessesTable.name, `${unique}%`));
    const bizIds = rows.map((r) => r.id);
    if (bizIds.length > 0) {
      await dbm.db.delete(dbm.eventsTable).where(inArray(dbm.eventsTable.businessId, bizIds));
      await dbm.db.delete(dbm.businessesTable).where(inArray(dbm.businessesTable.id, bizIds)); // visits cascade
    }
  });

  it("buckets a rep's prospects correctly and hides other reps, closed deals, and untouched prospects", async () => {
    const q = await followups.buildFollowUpQueue({ repId: REP_A, staleDays: 14 });
    const idsIn = (bucket: keyof typeof q.counts) => q[bucket].map((i) => i.businessId).sort();

    assert.deepEqual(idsIn("overdue"), [ids.overdue, ids.overdueHigh].sort());
    assert.deepEqual(idsIn("today"), [ids.today]);
    assert.deepEqual(idsIn("upcoming"), [ids.upcoming]);
    assert.deepEqual(idsIn("stale"), [ids.stale]);
    assert.deepEqual(q.counts, { overdue: 2, today: 1, upcoming: 1, stale: 1 });

    const all = [...q.overdue, ...q.today, ...q.upcoming, ...q.stale].map((i) => i.businessId);
    for (const hidden of [ids.fresh, ids.superseded, ids.won, ids.repB, ids.untouched]) {
      assert.ok(!all.includes(hidden), `business ${hidden} should not be in the queue`);
    }
  });

  it("orders overdue items by due date, then priority, then deal value", async () => {
    const q = await followups.buildFollowUpQueue({ repId: REP_A, staleDays: 14 });
    // Same due date → high priority first
    assert.equal(q.overdue[0]?.businessId, ids.overdueHigh);
    assert.equal(q.overdue[0]?.dealValue, 5000);
    assert.equal(q.overdue[0]?.daysSinceVisit, 3);
  });

  it("a leader (no repId) sees everyone's queue", async () => {
    const q = await followups.buildFollowUpQueue({ staleDays: 14 });
    const overdueIds = q.overdue.map((i) => i.businessId);
    assert.ok(overdueIds.includes(ids.repB));
    assert.ok(overdueIds.includes(ids.overdue));
  });

  it("applyVisitToStage promotes and stamps stageChangedAt, and logs an event", async () => {
    const bizId = await mkBiz("stage-promote");
    const visitId = await mkVisit({ businessId: bizId, repId: REP_A, outcome: "follow_up_needed" });
    const result = await stage.applyVisitToStage(bizId, { id: visitId, outcome: "follow_up_needed", repId: REP_A });
    assert.equal(result, "follow_up");

    const b = await statusOf(bizId);
    assert.equal(b.status, "follow_up");
    assert.ok(b.stageChangedAt);
    assert.equal(b.closedAt, null);

    const [ev] = await dbm.db
      .select()
      .from(dbm.eventsTable)
      .where(and(eq(dbm.eventsTable.businessId, bizId), eq(dbm.eventsTable.type, "business.stage_changed")))
      .orderBy(desc(dbm.eventsTable.id))
      .limit(1);
    assert.ok(ev, "stage_changed event logged");
    assert.deepEqual((ev.payload as Record<string, unknown>).from, "not_contacted");
    assert.deepEqual((ev.payload as Record<string, unknown>).to, "follow_up");
    assert.equal(ev.repId, REP_A);
    assert.equal(ev.visitId, visitId);
  });

  it("applyVisitToStage never demotes a converted prospect (regression)", async () => {
    const bizId = await mkBiz("stage-keep-won", { status: "converted", closedAt: new Date() });
    const visitId = await mkVisit({ businessId: bizId, repId: REP_A, outcome: "neutral" });
    const result = await stage.applyVisitToStage(bizId, { id: visitId, outcome: "neutral", repId: REP_A });
    assert.equal(result, null);
    assert.equal((await statusOf(bizId)).status, "converted");
  });

  it("moveStage to a terminal stage stamps closedAt; reopening clears it", async () => {
    const bizId = await mkBiz("stage-close", { status: "proposal_sent" });
    assert.equal(await stage.moveStage({ businessId: bizId, to: "converted", reason: "manual" }), "converted");
    let b = await statusOf(bizId);
    assert.ok(b.closedAt);

    assert.equal(await stage.moveStage({ businessId: bizId, to: "converted", reason: "manual" }), null, "no-op when unchanged");

    assert.equal(await stage.moveStage({ businessId: bizId, to: "follow_up", reason: "manual" }), "follow_up");
    b = await statusOf(bizId);
    assert.equal(b.closedAt, null);
  });
});
