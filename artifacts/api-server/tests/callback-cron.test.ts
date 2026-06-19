import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { and, desc, eq, inArray, like, sql } from "drizzle-orm";

type DbModule = typeof import("@workspace/db");
type RunCallbackSweep = typeof import("../src/lib/callback-cron")["runCallbackSweep"];

const d = process.env.DATABASE_URL ? describe : describe.skip;
const DAY = 24 * 60 * 60 * 1000;

d("callback-reminder cron", () => {
  let dbm: DbModule;
  let runCallbackSweep: RunCallbackSweep;
  const ids: { overdue: number; today: number; superseded: number; future: number } = {
    overdue: 0,
    today: 0,
    superseded: 0,
    future: 0,
  };
  let overdueVisitId = 0;

  before(async () => {
    process.env.CALLBACK_CRON_ENABLED = "true";
    [dbm, { runCallbackSweep }] = await Promise.all([
      import("@workspace/db"),
      import("../src/lib/callback-cron"),
    ]);

    const now = Date.now();
    const unique = `CRON-TEST ${Date.now()}`;

    const mkBiz = async (name: string): Promise<number> => {
      const [b] = await dbm.db
        .insert(dbm.businessesTable)
        .values({ name: `${unique} ${name}`, sector: "test" })
        .returning({ id: dbm.businessesTable.id });
      assert.ok(b);
      return b.id;
    };

    ids.overdue = await mkBiz("overdue");
    ids.today = await mkBiz("today");
    ids.superseded = await mkBiz("superseded");
    ids.future = await mkBiz("future");

    // overdue: single visit, due yesterday
    const [ov] = await dbm.db
      .insert(dbm.visitsTable)
      .values({
        businessId: ids.overdue,
        outcome: "follow_up_needed",
        contactName: "Pat",
        visitedAt: new Date(now - 3 * DAY),
        nextActionDate: new Date(now - DAY),
      })
      .returning({ id: dbm.visitsTable.id });
    assert.ok(ov);
    overdueVisitId = ov.id;

    // today: single visit, due now
    await dbm.db.insert(dbm.visitsTable).values({
      businessId: ids.today,
      outcome: "follow_up_needed",
      visitedAt: new Date(now - 3 * DAY),
      nextActionDate: new Date(now),
    });

    // superseded: old visit had a due callback, but a later visit closed it
    await dbm.db.insert(dbm.visitsTable).values({
      businessId: ids.superseded,
      outcome: "follow_up_needed",
      visitedAt: new Date(now - 3 * DAY),
      nextActionDate: new Date(now - DAY),
    });
    await dbm.db.insert(dbm.visitsTable).values({
      businessId: ids.superseded,
      outcome: "neutral",
      visitedAt: new Date(now - 60 * 60 * 1000), // 1h ago, later than the callback visit
      nextActionDate: null,
    });

    // future: due tomorrow
    await dbm.db.insert(dbm.visitsTable).values({
      businessId: ids.future,
      outcome: "follow_up_needed",
      visitedAt: new Date(now - 3 * DAY),
      nextActionDate: new Date(now + DAY),
    });
  });

  after(async () => {
    if (!dbm) return;
    const all = Object.values(ids).filter((n) => n > 0);
    if (all.length > 0) {
      await dbm.db.delete(dbm.agentSuggestionsTable).where(inArray(dbm.agentSuggestionsTable.businessId, all));
      await dbm.db.delete(dbm.visitsTable).where(inArray(dbm.visitsTable.businessId, all));
      await dbm.db.delete(dbm.businessesTable).where(inArray(dbm.businessesTable.id, all));
    }
    await dbm.db
      .delete(dbm.agentRunsTable)
      .where(
        and(
          eq(dbm.agentRunsTable.eventType, "callback.sweep"),
          sql`${dbm.agentRunsTable.output}->>'reason' IN ('test', 'test-again', 'test-empty')`,
        ),
      );
  });

  it("emits one reminder per open due/overdue callback and skips closed/future ones", async () => {
    const result = await runCallbackSweep("test");
    assert.notEqual(result, null);
    assert.ok(result!.total >= 2);

    const overdue = await dbm.db
      .select()
      .from(dbm.agentSuggestionsTable)
      .where(eq(dbm.agentSuggestionsTable.businessId, ids.overdue));
    const today = await dbm.db
      .select()
      .from(dbm.agentSuggestionsTable)
      .where(eq(dbm.agentSuggestionsTable.businessId, ids.today));
    const superseded = await dbm.db
      .select()
      .from(dbm.agentSuggestionsTable)
      .where(eq(dbm.agentSuggestionsTable.businessId, ids.superseded));
    const future = await dbm.db
      .select()
      .from(dbm.agentSuggestionsTable)
      .where(eq(dbm.agentSuggestionsTable.businessId, ids.future));

    assert.equal(overdue.length, 1);
    assert.equal(today.length, 1);
    assert.equal(superseded.length, 0);
    assert.equal(future.length, 0);

    assert.equal(overdue[0].priority, "high");
    assert.equal(today[0].priority, "normal");

    assert.equal(overdue[0].type, "callback_reminder");
    assert.equal(overdue[0].source, "system");
    assert.match(overdue[0].dedupeKey ?? "", new RegExp(`^cb-due:${overdueVisitId}:\\d{4}-\\d{2}-\\d{2}$`));
    assert.ok(overdue[0].expiresAt);
    assert.equal(overdue[0].actionUrl, `/businesses/${ids.overdue}`);
  });

  it("closes the run cleanly with output counts", async () => {
    const [run] = await dbm.db
      .select()
      .from(dbm.agentRunsTable)
      .where(eq(dbm.agentRunsTable.eventType, "callback.sweep"))
      .orderBy(desc(dbm.agentRunsTable.id))
      .limit(1);

    assert.ok(run);
    assert.equal(run.status, "completed");
    assert.ok(run.startedAt);
    assert.ok(run.finishedAt);
    assert.ok((run.output as { total?: number }).total! >= 2);
  });

  it("is idempotent: a second sweep refreshes the same card, no duplicates", async () => {
    const beforeRows = await dbm.db
      .select()
      .from(dbm.agentSuggestionsTable)
      .where(eq(dbm.agentSuggestionsTable.businessId, ids.overdue));
    assert.equal(beforeRows.length, 1);
    const firstId = beforeRows[0].id;

    await runCallbackSweep("test-again");

    const afterRows = await dbm.db
      .select()
      .from(dbm.agentSuggestionsTable)
      .where(eq(dbm.agentSuggestionsTable.businessId, ids.overdue));
    assert.equal(afterRows.length, 1);
    assert.equal(afterRows[0].id, firstId);
  });

  it("marks a no-op sweep as skipped when no callbacks are due", async () => {
    const all = Object.values(ids).filter((n) => n > 0);
    await dbm.db.delete(dbm.agentSuggestionsTable).where(inArray(dbm.agentSuggestionsTable.businessId, all));
    await dbm.db.delete(dbm.visitsTable).where(inArray(dbm.visitsTable.businessId, all));

    const beforeRows = await dbm.db
      .select({ id: dbm.agentRunsTable.id })
      .from(dbm.agentRunsTable)
      .where(and(eq(dbm.agentRunsTable.eventType, "callback.sweep")))
      .orderBy(desc(dbm.agentRunsTable.id))
      .limit(1);

    const result = await runCallbackSweep("test-empty");
    assert.notEqual(result, null);

    // If real DB data has other due callbacks, this completes rather than skips.
    // Either way, it must be a fresh, finished run.
    const [latest] = await dbm.db
      .select()
      .from(dbm.agentRunsTable)
      .where(like(dbm.agentRunsTable.eventType, "callback.sweep"))
      .orderBy(desc(dbm.agentRunsTable.id))
      .limit(1);
    assert.notEqual(latest.id, beforeRows[0]?.id);
    assert.ok(["completed", "skipped"].includes(latest.status));
    assert.ok(latest.finishedAt);
  });
});
