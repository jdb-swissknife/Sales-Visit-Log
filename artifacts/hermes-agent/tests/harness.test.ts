/**
 * Harness tests. We drive a real HermesClient with an injected, repId-aware
 * fetch so the multi-rep loop, per-rep run tracking, and the rep-scoped anchor
 * are exercised end-to-end without a network. The headline case: two reps run
 * in one tick must get INDEPENDENT anchors (each from its own most-recent visit)
 * even though GET /agent/context is global.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HermesClient } from "../src/client";
import { runHarness, parseRepIds } from "../src/harness";
import type { BusinessCtx } from "../src/types";

const NOON_CHICAGO = new Date("2026-06-19T17:00:00Z");

function biz(p: Partial<BusinessCtx> & { id: number }): BusinessCtx {
  return {
    id: p.id,
    name: p.name ?? `Biz ${p.id}`,
    address: p.address ?? null,
    sector: p.sector ?? "retail",
    status: p.status ?? "not_contacted",
    priority: p.priority ?? "medium",
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
  };
}

interface Captured {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
}

// Two clusters ~124 mi apart so an anchor only ever matches its own neighbor.
const BUSINESSES: BusinessCtx[] = [
  biz({ id: 1, name: "Anchor A", latitude: 41.8, longitude: -87.6, status: "prospect", priority: "high" }),
  biz({ id: 2, name: "Nearby A", latitude: 41.804, longitude: -87.6, status: "not_contacted" }),
  biz({ id: 10, name: "Anchor B", latitude: 40.0, longitude: -88.0, status: "prospect", priority: "high" }),
  biz({ id: 11, name: "Nearby B", latitude: 40.004, longitude: -88.0, status: "not_contacted" }),
];

// repId -> businessId of that rep's most-recent visit (the anchor source).
const ANCHOR_BY_REP: Record<string, number> = { "rep-A": 1, "rep-B": 10 };

function makeFetch(opts: {
  captured: Captured[];
  /** Return true to fail a given (repId, method, path). repId may be "". */
  failOn?: (repId: string, method: string, path: string) => boolean;
  runIdCounter?: { n: number };
}): typeof fetch {
  const counter = opts.runIdCounter ?? { n: 0 };
  return (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const repId = u.searchParams.get("repId") ?? body?.repId ?? "";
    opts.captured.push({ method, path: u.pathname, query: u.searchParams, body });

    if (opts.failOn?.(repId, method, u.pathname)) {
      return new Response("boom", { status: 500 });
    }

    let payload: unknown = {};
    if (u.pathname === "/api/agent/events") {
      const r = u.searchParams.get("repId") ?? "";
      const anchorId = ANCHOR_BY_REP[r];
      payload = anchorId ? [{ id: 99, type: "visit.created", businessId: anchorId, source: "server", createdAt: NOON_CHICAGO.toISOString() }] : [];
    } else if (u.pathname === "/api/agent/context") {
      payload = { businesses: BUSINESSES, upcomingCallbacks: [], generatedAt: NOON_CHICAGO.toISOString() };
    } else if (u.pathname === "/api/agent/runs") {
      payload = { id: ++counter.n }; // POST create-run
    } else if (u.pathname === "/api/agent/suggestions") {
      payload = { id: 1 };
    } else if (u.pathname.startsWith("/api/agent/runs/")) {
      payload = {}; // PATCH lifecycle
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function client(fetchImpl: typeof fetch): HermesClient {
  return new HermesClient({ baseUrl: "http://test", apiKey: "k", fetchImpl });
}

describe("parseRepIds", () => {
  it("splits on commas and whitespace, trims, drops empties", () => {
    assert.deepEqual(parseRepIds("rep-7, rep-9 ,, rep-3"), ["rep-7", "rep-9", "rep-3"]);
    assert.deepEqual(parseRepIds("  rep-1\n rep-2 "), ["rep-1", "rep-2"]);
    assert.deepEqual(parseRepIds(undefined), []);
    assert.deepEqual(parseRepIds(""), []);
  });
});

describe("runHarness", () => {
  it("gives two reps independent anchors in one tick", async () => {
    const captured: Captured[] = [];
    const res = await runHarness({
      client: client(makeFetch({ captured })),
      repIds: ["rep-A", "rep-B"],
      now: NOON_CHICAGO,
    });

    assert.equal(res.reps.length, 2);
    const a = res.reps.find((r) => r.repId === "rep-A")!;
    const b = res.reps.find((r) => r.repId === "rep-B")!;

    // Each rep anchors to ITS OWN most-recent visit, not the other's.
    assert.equal(a.result?.anchorBusinessId, 1);
    assert.equal(b.result?.anchorBusinessId, 10);

    // And only matches its own neighbor (proves anchors didn't bleed across).
    assert.deepEqual(a.result?.cards.map((c) => c.businessId), [2]);
    assert.deepEqual(b.result?.cards.map((c) => c.businessId), [11]);
    assert.equal(res.totalPosted, 2);

    // Each rep's events fetch was scoped by its own repId.
    const eventReps = captured
      .filter((c) => c.path === "/api/agent/events")
      .map((c) => c.query.get("repId"));
    assert.deepEqual(eventReps.sort(), ["rep-A", "rep-B"]);
  });

  it("opens a tracked run per rep and threads its id through suggestion + lifecycle", async () => {
    const captured: Captured[] = [];
    await runHarness({
      client: client(makeFetch({ captured })),
      repIds: ["rep-A", "rep-B"],
      now: NOON_CHICAGO,
    });

    // One create-run POST per rep.
    const creates = captured.filter((c) => c.method === "POST" && c.path === "/api/agent/runs");
    assert.equal(creates.length, 2);
    assert.equal(creates[0].body.eventType, "nearby_prospect.scheduled");

    // Each rep's suggestion carries the run id it was given, and that run is
    // PATCHed to completed.
    const suggestions = captured.filter((c) => c.path === "/api/agent/suggestions");
    assert.equal(suggestions.length, 2);
    for (const s of suggestions) assert.ok(typeof s.body.agentRunId === "number");

    const patched = captured
      .filter((c) => c.method === "PATCH" && c.path.startsWith("/api/agent/runs/"))
      .map((c) => c.body.status);
    // running + completed for each of the two runs.
    assert.equal(patched.filter((x) => x === "running").length, 2);
    assert.equal(patched.filter((x) => x === "completed").length, 2);
  });

  it("skips run tracking when asked (no create-run POST)", async () => {
    const captured: Captured[] = [];
    const res = await runHarness({
      client: client(makeFetch({ captured })),
      repIds: ["rep-A"],
      now: NOON_CHICAGO,
      skipRunTracking: true,
    });
    assert.equal(captured.filter((c) => c.method === "POST" && c.path === "/api/agent/runs").length, 0);
    assert.equal(res.reps[0].agentRunId, undefined);
    assert.equal(res.reps[0].result?.posted, 1);
  });

  it("isolates a per-rep failure: one rep throws, the other still runs", async () => {
    const captured: Captured[] = [];
    const res = await runHarness({
      client: client(
        makeFetch({
          captured,
          // Fail rep-A's events read; rep-B is untouched.
          failOn: (repId, method, path) =>
            path === "/api/agent/events" && repId === "rep-A",
        }),
      ),
      repIds: ["rep-A", "rep-B"],
      now: NOON_CHICAGO,
    });

    const a = res.reps.find((r) => r.repId === "rep-A")!;
    const b = res.reps.find((r) => r.repId === "rep-B")!;
    assert.ok(a.error, "rep-A should record an error");
    assert.equal(a.result, undefined);
    assert.equal(b.result?.anchorBusinessId, 10);
    assert.equal(b.result?.cards.length, 1);
    assert.equal(res.totalPosted, 1);
  });
});
