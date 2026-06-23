/**
 * coaching tests. The pure builders (analyzeVisits, buildCoachingTip,
 * buildCoachingCard, isoWeekKey, endOfWeekIso) are exercised directly; the
 * orchestrator (runCoaching) is driven through a real HermesClient with an
 * injected fetch so query building, insight persistence, and run lifecycle are
 * covered without a network.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HermesClient } from "../src/client";
import {
  DEFAULT_COACHING_CONFIG,
  analyzeVisits,
  buildCoachingTip,
  buildCoachingCard,
  isoWeekKey,
  endOfWeekIso,
  runCoaching,
  type CoachingConfig,
} from "../src/coaching";
import type { BusinessCtx, EventItem } from "../src/types";

// 14:00 America/Chicago (CDT, -05:00) on 2026-06-19 (a Friday).
const NOW = new Date("2026-06-19T19:00:00Z");
const cfg = DEFAULT_COACHING_CONFIG;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function visitEvent(
  outcome: string,
  opts?: { repId?: string; businessId?: number; createdAt?: string },
): EventItem {
  return {
    id: Math.floor(Math.random() * 100000),
    type: "visit.created",
    repId: opts?.repId ?? "rep-7",
    businessId: opts?.businessId ?? Math.floor(Math.random() * 1000),
    payload: { outcome, businessName: "Test Biz" },
    source: "server",
    createdAt: opts?.createdAt ?? "2026-06-19T18:00:00Z",
  };
}

/** Build N events newest-first, with the given outcomes (chronological order). */
function eventsFromOutcomes(
  outcomesChrono: string[],
  repId = "rep-7",
): EventItem[] {
  const chrono = outcomesChrono.map((o, i) =>
    visitEvent(o, {
      repId,
      businessId: 100 + i,
      createdAt: new Date(Date.UTC(2026, 5, 19, 10) + i * 3600000).toISOString(),
    }),
  );
  return chrono.reverse(); // feed returns newest-first
}

function makeBusinesses(n: number): BusinessCtx[] {
  return Array.from({ length: n }, (_, i) => ({
    id: 100 + i,
    name: `Biz ${i}`,
    address: null,
    sector: null,
    status: "not_contacted",
    priority: "medium",
    latitude: 44.98,
    longitude: -93.27,
  }));
}

interface Captured {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
}

function makeFetch(opts: {
  captured: Captured[];
  events?: unknown[];
  context?: unknown;
  failOn?: (method: string, path: string) => boolean;
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
      payload = opts.context ?? { businesses: [], upcomingCallbacks: [], generatedAt: "" };
    else if (u.pathname === "/api/agent/suggestions") payload = { id: 1 };
    else if (u.pathname === "/api/agent/rep-insights") payload = { id: 1 };
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

// ---------------------------------------------------------------------------
// analyzeVisits
// ---------------------------------------------------------------------------

describe("analyzeVisits", () => {
  it("counts outcomes correctly and reverses to chronological", () => {
    // Feed is newest-first: [neutral, interested, closed, not_interested]
    const events = eventsFromOutcomes([
      "not_interested",
      "closed",
      "interested",
      "neutral",
    ]);
    const a = analyzeVisits(events);
    assert.equal(a.total, 4);
    assert.equal(a.positives, 2);
    assert.equal(a.negatives, 1);
    assert.equal(a.neutrals, 1);
  });

  it("computes cold streak from the most recent visit", () => {
    const events = eventsFromOutcomes([
      "interested", // oldest
      "neutral",
      "neutral",
      "not_interested", // newest
    ]);
    const a = analyzeVisits(events);
    assert.equal(a.coldStreak, 3); // neutral, neutral, not_interested
    assert.equal(a.hotStreak, 0);
  });

  it("computes hot streak from the most recent visit", () => {
    const events = eventsFromOutcomes([
      "not_interested",
      "closed",
      "interested",
      "closed", // newest
    ]);
    const a = analyzeVisits(events);
    assert.equal(a.hotStreak, 3);
    assert.equal(a.coldStreak, 0);
  });

  it("handles mixed streaks", () => {
    const events = eventsFromOutcomes([
      "closed",
      "not_interested",
      "closed",
      "interested",
      "closed",
    ]);
    const a = analyzeVisits(events);
    assert.equal(a.hotStreak, 3); // closed, interested, closed (newest-first reversed)
    assert.equal(a.coldStreak, 0);
  });

  it("counts unique businesses", () => {
    const events = [
      visitEvent("neutral", { businessId: 1 }),
      visitEvent("neutral", { businessId: 2 }),
      visitEvent("neutral", { businessId: 1 }),
    ];
    const a = analyzeVisits(events);
    assert.equal(a.uniqueBusinesses, 2);
  });

  it("returns zeros for empty input", () => {
    const a = analyzeVisits([]);
    assert.equal(a.total, 0);
    assert.equal(a.positives, 0);
    assert.equal(a.coldStreak, 0);
    assert.equal(a.hotStreak, 0);
  });
});

// ---------------------------------------------------------------------------
// buildCoachingTip
// ---------------------------------------------------------------------------

describe("buildCoachingTip (pure)", () => {
  it("detects a cold streak as the top priority", () => {
    const events = eventsFromOutcomes([
      "closed",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
      "neutral", // 5 cold at the end
    ]);
    const a = analyzeVisits(events);
    const tip = buildCoachingTip(a, cfg)!;
    assert.ok(tip);
    assert.equal(tip.pattern, "cold_streak");
    assert.match(tip.title, /5 visits without a win/);
    assert.ok(tip.insightScore > 0);
  });

  it("detects low conversion when no streak but poor rate", () => {
    const events = eventsFromOutcomes([
      "not_interested",
      "neutral",
      "neutral",
      "not_interested",
      "neutral",
      "neutral",
      "not_interested",
      "closed", // newest = positive so no cold streak; 1/8 = 12.5% rate
    ]);
    const a = analyzeVisits(events);
    const tip = buildCoachingTip(a, cfg)!;
    assert.ok(tip);
    assert.equal(tip.pattern, "low_conversion");
    assert.match(tip.title, /Positive-outcome rate/);
  });

  it("detects a hot streak for reinforcement", () => {
    const events = eventsFromOutcomes([
      "not_interested",
      "not_interested",
      "closed",
      "interested",
      "closed", // 3 hot at the end
    ]);
    const a = analyzeVisits(events);
    const tip = buildCoachingTip(a, cfg)!;
    assert.ok(tip);
    assert.equal(tip.pattern, "hot_streak");
    assert.match(tip.title, /3 positive visits in a row/);
  });

  it("detects low coverage when context is provided", () => {
    // Mix outcomes so cold streak stays below threshold (last visit positive).
    const events = eventsFromOutcomes([
      "neutral",
      "neutral",
      "neutral",
      "neutral",
      "closed", // newest = positive, cold streak = 0
    ]);
    const a = analyzeVisits(events);
    const businesses = makeBusinesses(100);
    const tip = buildCoachingTip(a, cfg, businesses)!;
    assert.ok(tip);
    assert.equal(tip.pattern, "low_coverage");
    assert.match(tip.title, /Visited 5 of 100 prospects/);
  });

  it("returns null when no pattern meets threshold", () => {
    // 5 visits, 2 positives (40% rate), no streak, no context -> no pattern.
    const events = eventsFromOutcomes([
      "neutral",
      "interested",
      "neutral",
      "closed",
      "neutral",
    ]);
    const a = analyzeVisits(events);
    const tip = buildCoachingTip(a, cfg);
    assert.equal(tip, null);
  });

  it("cold_streak takes priority over low_conversion", () => {
    // Cold streak of 6 AND low conversion. Cold streak should win.
    const events = eventsFromOutcomes([
      "interested",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
    ]);
    const a = analyzeVisits(events);
    const tip = buildCoachingTip(a, cfg)!;
    assert.equal(tip.pattern, "cold_streak");
  });
});

// ---------------------------------------------------------------------------
// buildCoachingCard
// ---------------------------------------------------------------------------

describe("buildCoachingCard", () => {
  it("sets type=coaching, normal priority, weekly dedupeKey", () => {
    const card = buildCoachingCard({
      repId: "rep-7",
      tip: {
        pattern: "cold_streak",
        title: "test title",
        body: "test body",
        insightSummary: "summary",
        insightScore: 0.5,
      },
      period: "2026-W25",
      periodEnd: "2026-06-21T23:59:59-05:00",
      agentRunId: 42,
    });
    assert.equal(card.type, "coaching");
    assert.equal(card.priority, "normal");
    assert.equal(card.dedupeKey, "hermes:coaching:rep-7:2026-W25");
    assert.equal(card.expiresAt, "2026-06-21T23:59:59-05:00");
    assert.equal(card.agentRunId, 42);
    assert.equal((card as any).businessId, undefined);
    assert.equal((card.data as any).pattern, "cold_streak");
  });
});

// ---------------------------------------------------------------------------
// isoWeekKey + endOfWeekIso
// ---------------------------------------------------------------------------

describe("isoWeekKey", () => {
  it("produces a correct ISO week for a known Friday", () => {
    // 2026-06-19 is a Friday in ISO week 25.
    assert.equal(isoWeekKey(NOW, "America/Chicago"), "2026-W25");
  });

  it("handles Monday at the start of a week", () => {
    const monday = new Date("2026-06-15T19:00:00Z"); // 14:00 CDT Mon Jun 15
    assert.equal(isoWeekKey(monday, "America/Chicago"), "2026-W25");
  });

  it("handles Sunday end of a week", () => {
    const sunday = new Date("2026-06-21T19:00:00Z"); // 14:00 CDT Sun Jun 21
    assert.equal(isoWeekKey(sunday, "America/Chicago"), "2026-W25");
  });
});

describe("endOfWeekIso", () => {
  it("produces end-of-Sunday for the current week", () => {
    const end = endOfWeekIso(NOW, "America/Chicago");
    assert.match(end, /^2026-06-21T23:59:59-05:00$/);
  });
});

// ---------------------------------------------------------------------------
// runCoaching (orchestration + lifecycle)
// ---------------------------------------------------------------------------

describe("runCoaching (orchestration + lifecycle)", () => {
  it("scopes feed by repId + type=visit, posts card + insight, reports completed", async () => {
    const captured: Captured[] = [];
    const events = eventsFromOutcomes([
      "interested",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
      "neutral", // 5 cold at end
    ]);
    const res = await runCoaching({
      client: client(
        makeFetch({
          captured,
          events,
          context: {
            businesses: makeBusinesses(10),
            upcomingCallbacks: [],
            generatedAt: "",
          },
        }),
      ),
      repId: "rep-7",
      now: NOW,
      agentRunId: 42,
    });

    assert.equal(res.posted, 1);
    assert.equal(res.insightPosted, true);
    assert.equal(res.pattern, "cold_streak");
    assert.equal(res.period, "2026-W25");

    // Verify the events query
    const ev = captured.find((c) => c.path === "/api/agent/events")!;
    assert.equal(ev.query.get("repId"), "rep-7");
    assert.equal(ev.query.get("type"), "visit");

    // Verify the suggestion card
    const sugg = captured.find((c) => c.path === "/api/agent/suggestions")!;
    assert.equal(sugg.body.type, "coaching");
    assert.equal(sugg.body.priority, "normal");
    assert.match(sugg.body.dedupeKey, /hermes:coaching:rep-7:2026-W25/);
    assert.equal(sugg.body.agentRunId, 42);

    // Verify the rep-insight was posted
    const insight = captured.find((c) => c.path === "/api/agent/rep-insights")!;
    assert.equal(insight.body.repId, "rep-7");
    assert.equal(insight.body.type, "cold_streak");
    assert.ok(typeof insight.body.score === "number");

    // Lifecycle: running -> completed
    const statuses = captured
      .filter((c) => c.method === "PATCH" && c.path === "/api/agent/runs/42")
      .map((c) => c.body.status);
    assert.deepEqual(statuses, ["running", "completed"]);
  });

  it("skips (no_visit_events) when the rep has no visits", async () => {
    const captured: Captured[] = [];
    const res = await runCoaching({
      client: client(makeFetch({ captured, events: [] })),
      repId: "rep-7",
      now: NOW,
      agentRunId: 7,
    });
    assert.equal(res.posted, 0);
    assert.equal(res.skipped, "no_visit_events");
    assert.equal(captured.some((c) => c.path === "/api/agent/suggestions"), false);
    const statuses = captured
      .filter((c) => c.path === "/api/agent/runs/7")
      .map((c) => c.body.status);
    assert.deepEqual(statuses, ["running", "skipped"]);
  });

  it("skips (not_enough_visits) when there are too few events", async () => {
    const events = eventsFromOutcomes(["neutral", "neutral"]); // < minVisits (5)
    const captured: Captured[] = [];
    const res = await runCoaching({
      client: client(makeFetch({ captured, events })),
      repId: "rep-7",
      now: NOW,
    });
    assert.equal(res.skipped, "not_enough_visits");
  });

  it("skips (stale_events) when the latest event is too old", async () => {
    const events = eventsFromOutcomes(
      Array.from({ length: 6 }, () => "neutral"),
    ).map((e) => ({
      ...e,
      createdAt: "2026-06-01T00:00:00Z", // 18 days ago
    }));
    const captured: Captured[] = [];
    const res = await runCoaching({
      client: client(makeFetch({ captured, events })),
      repId: "rep-7",
      now: NOW,
    });
    assert.equal(res.skipped, "stale_events");
  });

  it("skips (no_actionable_pattern) when visits are healthy", async () => {
    // 5 visits, 2 positives (40%), no streak -> no pattern.
    const events = eventsFromOutcomes([
      "neutral",
      "interested",
      "neutral",
      "closed",
      "neutral",
    ]);
    const captured: Captured[] = [];
    const res = await runCoaching({
      client: client(
        makeFetch({
          captured,
          events,
          context: {
            businesses: makeBusinesses(5), // coverage = 5/5 = 100%
            upcomingCallbacks: [],
            generatedAt: "",
          },
        }),
      ),
      repId: "rep-7",
      now: NOW,
    });
    assert.equal(res.skipped, "no_actionable_pattern");
  });

  it("posts card even when insight persistence fails", async () => {
    const events = eventsFromOutcomes([
      "closed",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
    ]);
    const captured: Captured[] = [];
    const res = await runCoaching({
      client: client(
        makeFetch({
          captured,
          events,
          failOn: (m, p) => m === "POST" && p === "/api/agent/rep-insights",
        }),
      ),
      repId: "rep-7",
      now: NOW,
      agentRunId: 5,
    });
    assert.equal(res.posted, 1);
    assert.equal(res.insightPosted, false);
    assert.equal(res.pattern, "cold_streak");
  });

  it("reports failed and rethrows when posting the card throws", async () => {
    const events = eventsFromOutcomes([
      "interested",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
    ]);
    const captured: Captured[] = [];
    await assert.rejects(
      runCoaching({
        client: client(
          makeFetch({
            captured,
            events,
            failOn: (m, p) => m === "POST" && p === "/api/agent/suggestions",
          }),
        ),
        repId: "rep-7",
        now: NOW,
        agentRunId: 99,
      }),
      /500/,
    );
    const statuses = captured
      .filter((c) => c.path === "/api/agent/runs/99")
      .map((c) => c.body.status);
    assert.deepEqual(statuses, ["running", "failed"]);
  });

  it("does not let a telemetry PATCH failure discard a successful run", async () => {
    const events = eventsFromOutcomes([
      "closed",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
      "neutral",
    ]);
    const captured: Captured[] = [];
    const res = await runCoaching({
      client: client(
        makeFetch({
          captured,
          events,
          failOn: (m, p) => m === "PATCH" && p.startsWith("/api/agent/runs/"),
        }),
      ),
      repId: "rep-7",
      now: NOW,
      agentRunId: 88,
    });
    assert.equal(res.posted, 1);
  });
});
