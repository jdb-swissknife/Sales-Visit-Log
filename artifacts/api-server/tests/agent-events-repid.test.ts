import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

type DbModule = typeof import("@workspace/db");

// Same DB-gating convention as callback-cron.test.ts: only run when a database
// is configured; skip cleanly otherwise.
const d = process.env.DATABASE_URL ? describe : describe.skip;

d("GET /api/agent/events — repId scoping", () => {
  let dbm: DbModule;
  let server: Server;
  let baseUrl = "";
  const KEY = "test-agent-key";
  const tag = `REPID-TEST ${Date.now()}`;
  const repA = `rep-A-${Date.now()}`;
  const repB = `rep-B-${Date.now()}`;
  const repC = `rep-C-${Date.now()}`;
  let businessId = 0;

  const get = async (qs: string) => {
    const res = await fetch(`${baseUrl}/api/agent/events${qs}`, {
      headers: { authorization: `Bearer ${KEY}` },
    });
    return { status: res.status, body: (await res.json()) as any[] };
  };

  before(async () => {
    process.env.AGENT_API_KEY = KEY;
    process.env.HERMES_WEBHOOK_URL = ""; // keep logEvent's webhook a no-op
    const appMod = await import("../src/app");
    dbm = await import("@workspace/db");

    const [biz] = await dbm.db
      .insert(dbm.businessesTable)
      .values({ name: `${tag} biz`, sector: "test" })
      .returning({ id: dbm.businessesTable.id });
    assert.ok(biz);
    businessId = biz.id;

    // Seed events directly with distinct rep_id values (+ a NULL-rep, NULL-payload row).
    await dbm.db.insert(dbm.eventsTable).values([
      { type: "visit.created", entityType: "visit", businessId, repId: repA, payload: { tag, who: "A1" } },
      { type: "visit.created", entityType: "visit", businessId, repId: repA, payload: { tag, who: "A2" } },
      { type: "visit.created", entityType: "visit", businessId, repId: repB, payload: { tag, who: "B1" } },
      { type: "note.created", entityType: "note", businessId, repId: repA, payload: { tag, who: "A-note" } },
      // NULL rep + NULL payload: must never match an explicit repId and must not 500 the feed.
      { type: "visit.created", entityType: "visit", businessId, repId: null, payload: null },
    ]);

    server = appMod.default.listen(0);
    await new Promise<void>((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("scopes the feed to a single rep (rep-A only; rep-B and NULL-rep excluded)", async () => {
    const { status, body } = await get(`?repId=${repA}&limit=500`);
    assert.equal(status, 200);
    const mine = body.filter((e) => e.payload?.tag === tag || e.repId === repA);
    assert.ok(mine.length >= 3, `expected >=3 rep-A events, got ${mine.length}`);
    assert.ok(mine.every((e) => e.repId === repA), "all returned events must be rep-A");
    assert.ok(!body.some((e) => e.repId === repB), "rep-B must not appear");
  });

  it("omitting repId returns the unfiltered feed (back-compat: includes rep-B and NULL-rep rows)", async () => {
    const { status, body } = await get(`?limit=500`);
    assert.equal(status, 200);
    const ours = body.filter((e) => e.businessId === businessId);
    assert.ok(ours.some((e) => e.repId === repA), "rep-A present unfiltered");
    assert.ok(ours.some((e) => e.repId === repB), "rep-B present unfiltered");
    assert.ok(ours.some((e) => e.repId == null), "NULL-rep row present unfiltered");
    // NULL payload row must round-trip without 500ing the feed.
    const nullRow = ours.find((e) => e.repId == null);
    assert.ok(nullRow, "null-rep row found");
    assert.equal(nullRow.payload ?? null, null);
  });

  it("type + repId compose (type=visit&repId=rep-A&limit=1 → rep-A's newest visit, not the note)", async () => {
    const { status, body } = await get(`?type=visit&repId=${repA}&limit=1`);
    assert.equal(status, 200);
    assert.equal(body.length, 1);
    assert.equal(body[0].repId, repA);
    assert.ok(body[0].type.startsWith("visit"), "must be a visit event");
  });

  it("two reps' feeds do not bleed (rep-B feed excludes rep-A)", async () => {
    const { body } = await get(`?repId=${repB}&limit=500`);
    assert.ok(body.every((e) => e.repId === repB), "all rep-B");
    assert.ok(!body.some((e) => e.repId === repA), "no rep-A in rep-B feed");
  });

  it("write path: POST /api/visits with repId emits a visit.created event carrying that rep", async () => {
    const res = await fetch(`${baseUrl}/api/visits`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        businessId,
        visitedAt: new Date().toISOString(),
        outcome: "positive",
        repId: repC,
      }),
    });
    assert.equal(res.status, 201);
    // logEvent runs fire-and-forget; poll briefly for the derived event.
    let found: any;
    for (let i = 0; i < 20 && !found; i++) {
      const { body } = await get(`?type=visit&repId=${repC}&limit=10`);
      found = body.find((e) => e.repId === repC);
      if (!found) await new Promise((r) => setTimeout(r, 50));
    }
    assert.ok(found, "visit.created event with repId from the visit should be derivable");
    assert.equal(found.type, "visit.created");
  });
});
