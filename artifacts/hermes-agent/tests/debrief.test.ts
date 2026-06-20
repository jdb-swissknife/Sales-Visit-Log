/**
 * debrief tests. The pure builder (buildDebrief / parseDaySummary) is exercised
 * directly; the orchestrator (runDebrief) is driven through a real HermesClient
 * with an injected fetch so query building and run lifecycle are covered without
 * a network. The free-form daySummary parsing is the part most worth pinning.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HermesClient } from "../src/client";
import {
  DEFAULT_DEBRIEF_CONFIG,
  buildDebrief,
  parseDaySummary,
  runDebrief,
  endOfNextDayIso,
} from "../src/debrief";

// 18:30 America/Chicago (CDT, -05:00) on 2026-06-19.
const NOW = new Date("2026-06-19T23:30:00Z");
const cfg = DEFAULT_DEBRIEF_CONFIG;

interface Captured {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
}

function makeFetch(opts: {
  captured: Captured[];
  events?: unknown[];
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

function dayEvent(payload: unknown, createdAt = "2026-06-19T23:00:00Z") {
  return { id: 5, type: "day.ended", repId: "rep-7", payload, source: "server", createdAt };
}

describe("parseDaySummary", () => {
  it("pulls counts via synonyms and explicit priorities", () => {
    const p = parseDaySummary({
      visitsCount: 4,
      wins: 1,
      prospectsAdded: 2,
      callbacksScheduled: 3,
      tomorrow: ["Revisit Acme", "Call Dana", "Prep demo", "Extra"],
    });
    assert.equal(p.visits, 4);
    assert.equal(p.closes, 1);
    assert.equal(p.newProspects, 2);
    assert.equal(p.callbacks, 3);
    assert.deepEqual(p.priorities, ["Revisit Acme", "Call Dana", "Prep demo", "Extra"]);
  });

  it("is tolerant of garbage and missing fields", () => {
    const p = parseDaySummary({ visits: "lots", priorities: [1, 2] as any });
    assert.equal(p.visits, undefined);
    assert.deepEqual(p.priorities, []);
  });

  it("returns an empty parse for null/undefined", () => {
    assert.deepEqual(parseDaySummary(null), { priorities: [] });
    assert.deepEqual(parseDaySummary(undefined), { priorities: [] });
  });
});

describe("buildDebrief (pure)", () => {
  it("builds a grounded card from counts + explicit priorities", () => {
    const card = buildDebrief({
      repId: "rep-7",
      daySummary: { visits: 4, closes: 1, date: "2026-06-19", priorities: ["Revisit Acme", "Call Dana"] },
      occurredAt: NOW,
      now: NOW,
      cfg,
    })!;
    assert.ok(card);
    assert.equal(card.type, "debrief");
    assert.equal(card.priority, "normal");
    assert.equal(card.dedupeKey, "hermes:debrief:rep-7:2026-06-19");
    assert.match(card.title, /4 visits, 1 close/);
    assert.match(card.body, /Tomorrow's focus:/);
    assert.match(card.body, /- Revisit Acme/);
    assert.match(card.body, /- Call Dana/);
    // expiry is end of the NEXT local day.
    assert.match(card.expiresAt, /^2026-06-20T23:59:59-05:00$/);
    assert.equal((card.data as any).visits, 4);
    assert.equal((card as any).businessId, undefined);
  });

  it("caps priorities at maxPriorities", () => {
    const card = buildDebrief({
      repId: "rep-7",
      daySummary: { visits: 1, priorities: ["a", "b", "c", "d", "e"] },
      occurredAt: NOW,
      now: NOW,
      cfg,
    })!;
    const bullets = card.body.split("\n").filter((l) => l.startsWith("- "));
    assert.equal(bullets.length, cfg.maxPriorities);
  });

  it("derives priorities from outcomes/callbacks when none are explicit", () => {
    const card = buildDebrief({
      repId: "rep-7",
      daySummary: { visits: 3, callbacks: 1, outcomes: { interested: 2, not_interested: 1 } },
      occurredAt: NOW,
      now: NOW,
      cfg,
    })!;
    assert.match(card.body, /Follow up with 2 interested prospects/);
    assert.match(card.body, /1 callback lined up/);
  });

  it("summarizes outcomes in the recap when no counts are present", () => {
    const card = buildDebrief({
      repId: "rep-7",
      daySummary: { outcomes: { interested: 2, closed: 1 } },
      occurredAt: NOW,
      now: NOW,
      cfg,
    })!;
    assert.match(card.title, /interested ×2/);
  });

  it("falls back to the event date when the summary omits one", () => {
    const card = buildDebrief({
      repId: "rep-7",
      daySummary: { visits: 2 },
      occurredAt: NOW, // 18:30 CDT on the 19th
      now: NOW,
      cfg,
    })!;
    assert.equal(card.dedupeKey, "hermes:debrief:rep-7:2026-06-19");
  });

  it("returns null when there is nothing to say", () => {
    assert.equal(
      buildDebrief({ repId: "rep-7", daySummary: {}, occurredAt: NOW, now: NOW, cfg }),
      null,
    );
    assert.equal(
      buildDebrief({ repId: "rep-7", daySummary: null, occurredAt: NOW, now: NOW, cfg }),
      null,
    );
  });
});

describe("endOfNextDayIso", () => {
  it("rolls to the next local day at 23:59:59 with offset", () => {
    assert.equal(endOfNextDayIso(NOW, "America/Chicago"), "2026-06-20T23:59:59-05:00");
  });
  it("rolls across a month boundary", () => {
    const lastDay = new Date("2026-06-30T18:00:00Z"); // 13:00 CDT on the 30th
    assert.equal(endOfNextDayIso(lastDay, "America/Chicago"), "2026-07-01T23:59:59-05:00");
  });
});

describe("runDebrief (orchestration + lifecycle)", () => {
  it("scopes the feed by repId and type, posts one card, reports completed", async () => {
    const captured: Captured[] = [];
    const res = await runDebrief({
      client: client(
        makeFetch({
          captured,
          events: [dayEvent({ visits: 4, closes: 1, priorities: ["Revisit Acme"] })],
        }),
      ),
      repId: "rep-7",
      now: NOW,
      agentRunId: 42,
    });

    assert.equal(res.posted, 1);
    assert.equal(res.dedupeKey, "hermes:debrief:rep-7:2026-06-19");

    const ev = captured.find((c) => c.path === "/api/agent/events")!;
    assert.equal(ev.query.get("repId"), "rep-7");
    assert.equal(ev.query.get("type"), "day.ended");
    assert.equal(ev.query.get("limit"), "1");

    const sugg = captured.find((c) => c.path === "/api/agent/suggestions")!;
    assert.equal(sugg.body.type, "debrief");
    assert.equal(sugg.body.agentRunId, 42);

    const statuses = captured
      .filter((c) => c.method === "PATCH" && c.path === "/api/agent/runs/42")
      .map((c) => c.body.status);
    assert.deepEqual(statuses, ["running", "completed"]);
  });

  it("skips (no_day_ended) when the rep has no day.ended event", async () => {
    const captured: Captured[] = [];
    const res = await runDebrief({
      client: client(makeFetch({ captured, events: [] })),
      repId: "rep-7",
      now: NOW,
      agentRunId: 7,
    });
    assert.equal(res.posted, 0);
    assert.equal(res.skipped, "no_day_ended");
    const statuses = captured
      .filter((c) => c.path === "/api/agent/runs/7")
      .map((c) => c.body.status);
    assert.deepEqual(statuses, ["running", "skipped"]);
    assert.equal(captured.some((c) => c.path === "/api/agent/suggestions"), false);
  });

  it("skips (stale_day_ended) when the latest day.ended is too old", async () => {
    const captured: Captured[] = [];
    const res = await runDebrief({
      client: client(
        makeFetch({ captured, events: [dayEvent({ visits: 4 }, "2026-06-15T00:00:00Z")] }),
      ),
      repId: "rep-7",
      now: NOW,
    });
    assert.equal(res.skipped, "stale_day_ended");
    assert.equal(captured.some((c) => c.path === "/api/agent/suggestions"), false);
  });

  it("skips (empty_day_summary) when the summary carries nothing", async () => {
    const captured: Captured[] = [];
    const res = await runDebrief({
      client: client(makeFetch({ captured, events: [dayEvent({})] })),
      repId: "rep-7",
      now: NOW,
    });
    assert.equal(res.skipped, "empty_day_summary");
    assert.equal(captured.some((c) => c.path === "/api/agent/suggestions"), false);
  });

  it("reports failed and rethrows when posting throws", async () => {
    const captured: Captured[] = [];
    await assert.rejects(
      runDebrief({
        client: client(
          makeFetch({
            captured,
            events: [dayEvent({ visits: 4, priorities: ["x"] })],
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
    const captured: Captured[] = [];
    const res = await runDebrief({
      client: client(
        makeFetch({
          captured,
          events: [dayEvent({ visits: 4, priorities: ["x"] })],
          failOn: (m, p) => m === "PATCH" && p.startsWith("/api/agent/runs/"),
        }),
      ),
      repId: "rep-7",
      now: NOW,
      agentRunId: 99,
    });
    assert.equal(res.posted, 1);
  });
});
