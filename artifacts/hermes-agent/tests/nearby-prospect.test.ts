/**
 * Orchestrator tests for runNearbyProspect. We drive a real HermesClient with
 * an injected fetch so the query-string building and run lifecycle are exercised
 * end-to-end without a network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HermesClient } from "../src/client";
import { runNearbyProspect } from "../src/nearby-prospect";
import type { BusinessCtx } from "../src/types";

const NOON_CHICAGO = new Date("2026-06-19T17:00:00Z");
const NIGHT_CHICAGO = new Date("2026-06-19T05:00:00Z"); // midnight-ish, outside window

interface Captured {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
}

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

function makeFetch(opts: {
  events?: unknown[];
  businesses?: BusinessCtx[];
  /** Return true to make a given (method, path) respond 500. */
  failOn?: (method: string, path: string) => boolean;
  captured: Captured[];
}): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    opts.captured.push({ method, path: u.pathname, query: u.searchParams, body });

    if (opts.failOn?.(method, u.pathname)) {
      return new Response("boom", { status: 500 });
    }

    let payload: unknown = {};
    if (u.pathname === "/api/agent/events") payload = opts.events ?? [];
    else if (u.pathname === "/api/agent/context")
      payload = {
        businesses: opts.businesses ?? [],
        upcomingCallbacks: [],
        generatedAt: NOON_CHICAGO.toISOString(),
      };
    else if (u.pathname === "/api/agent/suggestions") payload = { id: 1 };
    else if (u.pathname.startsWith("/api/agent/runs/")) payload = {};

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function client(fetchImpl: typeof fetch): HermesClient {
  return new HermesClient({
    baseUrl: "http://localhost:8080",
    apiKey: "test-key",
    fetchImpl,
  });
}

// A typical happy-path world: anchor visit at biz 1, one eligible neighbor.
function happyWorld(captured: Captured[]) {
  return makeFetch({
    captured,
    events: [{ id: 9, type: "visit", businessId: 1, source: "app", createdAt: "x" }],
    businesses: [
      biz({ id: 1, name: "Anchor", latitude: 41.8, longitude: -87.6 }),
      biz({
        id: 2,
        name: "Neighbor",
        status: "not_contacted",
        latitude: 41.8,
        longitude: -87.595,
      }),
    ],
  });
}

describe("runNearbyProspect: rep scoping (#1)", () => {
  it("passes repId through to the anchor events lookup", async () => {
    const captured: Captured[] = [];
    const result = await runNearbyProspect({
      client: client(happyWorld(captured)),
      repId: "rep-7",
      now: NOON_CHICAGO,
    });

    const eventsCall = captured.find((c) => c.path === "/api/agent/events");
    assert.ok(eventsCall, "expected an events lookup");
    assert.equal(eventsCall.query.get("repId"), "rep-7");
    assert.equal(eventsCall.query.get("type"), "visit");
    assert.equal(eventsCall.query.get("limit"), "1");
    assert.equal(result.posted, 1);
    assert.equal(result.cards[0].businessId, 2);
  });

  it("omits repId from the query when none is supplied", async () => {
    const captured: Captured[] = [];
    await runNearbyProspect({
      client: client(happyWorld(captured)),
      now: NOON_CHICAGO,
    });
    const eventsCall = captured.find((c) => c.path === "/api/agent/events");
    assert.ok(eventsCall);
    assert.equal(eventsCall.query.has("repId"), false);
  });
});

describe("runNearbyProspect: run lifecycle (#5)", () => {
  it("reports failed and rethrows when posting a suggestion throws", async () => {
    const captured: Captured[] = [];
    const fetchImpl = makeFetch({
      captured,
      failOn: (m, p) => m === "POST" && p === "/api/agent/suggestions",
      events: [{ id: 9, type: "visit", businessId: 1, source: "app", createdAt: "x" }],
      businesses: [
        biz({ id: 1, name: "Anchor", latitude: 41.8, longitude: -87.6 }),
        biz({ id: 2, status: "not_contacted", latitude: 41.8, longitude: -87.595 }),
      ],
    });

    await assert.rejects(
      runNearbyProspect({
        client: client(fetchImpl),
        repId: "rep-7",
        now: NOON_CHICAGO,
        agentRunId: 99,
      }),
      /500/,
    );

    const runPatches = captured.filter(
      (c) => c.method === "PATCH" && c.path === "/api/agent/runs/99",
    );
    assert.deepEqual(
      runPatches.map((c) => c.body.status),
      ["running", "failed"],
    );
    assert.match(runPatches[1].body.error, /500/);
  });

  it("does not let a telemetry PATCH failure discard a successful run", async () => {
    const captured: Captured[] = [];
    const fetchImpl = makeFetch({
      captured,
      // Every run-status PATCH fails; the run should still succeed.
      failOn: (m, p) => m === "PATCH" && p.startsWith("/api/agent/runs/"),
      events: [{ id: 9, type: "visit", businessId: 1, source: "app", createdAt: "x" }],
      businesses: [
        biz({ id: 1, name: "Anchor", latitude: 41.8, longitude: -87.6 }),
        biz({ id: 2, status: "not_contacted", latitude: 41.8, longitude: -87.595 }),
      ],
    });

    const result = await runNearbyProspect({
      client: client(fetchImpl),
      repId: "rep-7",
      now: NOON_CHICAGO,
      agentRunId: 99,
    });

    assert.equal(result.posted, 1);
    assert.equal(result.cards[0].businessId, 2);
  });

  it("reports completed when cards post", async () => {
    const captured: Captured[] = [];
    await runNearbyProspect({
      client: client(happyWorld(captured)),
      repId: "rep-7",
      now: NOON_CHICAGO,
      agentRunId: 42,
    });
    const statuses = captured
      .filter((c) => c.method === "PATCH" && c.path === "/api/agent/runs/42")
      .map((c) => c.body.status);
    assert.deepEqual(statuses, ["running", "completed"]);
  });

  it("reports skipped when nothing fires (outside drop-in window)", async () => {
    const captured: Captured[] = [];
    const result = await runNearbyProspect({
      client: client(happyWorld(captured)),
      repId: "rep-7",
      now: NIGHT_CHICAGO,
      agentRunId: 7,
    });
    assert.equal(result.posted, 0);
    assert.equal(result.skipped, "outside_drop_in_window");
    const statuses = captured
      .filter((c) => c.method === "PATCH" && c.path === "/api/agent/runs/7")
      .map((c) => c.body.status);
    assert.deepEqual(statuses, ["running", "skipped"]);
  });
});
