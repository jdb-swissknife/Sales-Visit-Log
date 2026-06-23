/**
 * Tests for the sync orchestration (syncRep). Uses injectable factories to
 * mock the Plaud MCP client and the GPT structuring function, plus an injected
 * fetch mock for the SVL API client.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { SvlClient } from "../src/svl-client";
import { syncRep, type SyncOptions } from "../src/sync";
import type { PlaudRecording, PlaudFileDetail, PlaudMcpClient, PlaudNote } from "../src/plaud-client";
import type { StructuredVisit } from "../src/types";

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

function mockMcpClient(
  recordings: PlaudRecording[],
  fileDetails: Record<string, PlaudFileDetail>,
): (tokenDir: string) => PlaudMcpClient {
  return () =>
    ({
      async start() {},
      async stop() {},
      async listFiles() {
        return recordings;
      },
      async getFile(id: string) {
        return fileDetails[id];
      },
      async getNote(id: string): Promise<PlaudNote> {
        return {};
      },
    }) as unknown as PlaudMcpClient;
}

function mockFetch(opts: {
  captured: Array<{ method: string; path: string; body: any }>;
  businesses?: unknown[];
}): typeof fetch {
  return (async (url: string | URL, init?: RequestInit) => {
    const u = new URL(String(url));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    opts.captured.push({ method, path: u.pathname, body });

    let payload: unknown = {};
    if (u.pathname === "/api/businesses") {
      payload = opts.businesses ?? [];
    } else if (u.pathname === "/api/visits") {
      payload = { id: 100, businessId: body?.businessId };
    } else if (u.pathname === "/api/media") {
      payload = { id: 200 };
    } else if (u.pathname === "/api/agent/events") {
      payload = {};
    }

    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

function svlClient(fetchImpl: typeof fetch): SvlClient {
  return new SvlClient({
    baseUrl: "http://localhost:8080",
    apiKey: "test-key",
    fetchImpl,
  });
}

// ---------------------------------------------------------------------------
// Test data
// ---------------------------------------------------------------------------

const RECORDINGS: PlaudRecording[] = [
  {
    id: "rec-1",
    name: "Visit to Acme Corp",
    created_at: "2026-06-23T14:00:00Z",
    start_at: "2026-06-23T13:55:00Z",
    duration: 30000,
    serial_number: "PLA001",
  },
  {
    id: "rec-2",
    name: "Quick note after visit",
    created_at: "2026-06-23T15:00:00Z",
    start_at: "2026-06-23T14:55:00Z",
    duration: 15000,
    serial_number: "PLA001",
  },
];

const FILE_DETAILS: Record<string, PlaudFileDetail> = {
  "rec-1": {
    id: "rec-1",
    name: "Visit to Acme Corp",
    created_at: "2026-06-23T14:00:00Z",
    start_at: "2026-06-23T13:55:00Z",
    duration: 30000,
    serial_number: "PLA001",
    presigned_url: "https://example.com/audio/rec-1.m4a",
    source_list: [
      { speaker: "Me", start: 0, end: 5000, text: "Just left Acme Corp. Great meeting." },
      { speaker: "Me", start: 5000, end: 10000, text: "They're very interested in our service." },
    ],
  },
  "rec-2": {
    id: "rec-2",
    name: "Quick note after visit",
    created_at: "2026-06-23T15:00:00Z",
    start_at: "2026-06-23T14:55:00Z",
    duration: 15000,
    serial_number: "PLA001",
    source_list: [
      { speaker: "Me", start: 0, end: 5000, text: "Stopped by a place with no name on the door. Nobody was there." },
    ],
  },
};

const STRUCTURED_1: StructuredVisit = {
  summary: "Great meeting at Acme, they're interested.",
  interestLevel: "hot",
  objections: [],
  followUpItems: ["Send pricing sheet"],
  businessName: "Acme Corp",
  nextStep: "Follow up Monday",
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("syncRep", () => {
  it("creates a visit when business matches", async () => {
    const captured: Array<{ method: string; path: string; body: any }> = [];
    const result = await syncRep({
      svl: svlClient(mockFetch({
        captured,
        businesses: [{ id: 1, name: "Acme Corp" }, { id: 2, name: "Other Inc" }],
      })),
      repId: "rep-7",
      tokenDir: "/tmp/tokens",
      mcpClientFactory: mockMcpClient(RECORDINGS, FILE_DETAILS),
      structuringFn: async (t: string) => {
        if (t.includes("Acme")) return STRUCTURED_1;
        return {
          summary: "Nobody there",
          interestLevel: "cool",
          objections: [],
          followUpItems: [],
        };
      },
      now: new Date("2026-06-23T16:00:00Z"),
    });

    assert.equal(result.repId, "rep-7");
    assert.equal(result.processed, 2);
    assert.equal(result.errors, 0);

    const visitRecording = result.recordings.find((r) => r.plaudId === "rec-1")!;
    assert.equal(visitRecording.outcome, "visit_created");
    assert.equal(visitRecording.businessId, 1);
    assert.equal(visitRecording.businessName, "Acme Corp");
    assert.ok(visitRecording.matchConfidence! > 0.5);

    // Verify visit was created via API
    const visitCalls = captured.filter((c) => c.path === "/api/visits");
    assert.equal(visitCalls.length, 1);
    assert.equal(visitCalls[0].body.businessId, 1);
    assert.equal(visitCalls[0].body.outcome, "interested");
    assert.equal(visitCalls[0].body.repId, "rep-7");

    // Verify media was created
    const mediaCalls = captured.filter((c) => c.path === "/api/media");
    assert.equal(mediaCalls.length, 1);
    assert.equal(mediaCalls[0].body.transcriptionStatus, "done");
    assert.ok(mediaCalls[0].body.transcript);
    assert.ok(mediaCalls[0].body.aiStructured);
  });

  it("creates voice_log when no business matches", async () => {
    const captured: Array<{ method: string; path: string; body: any }> = [];
    const result = await syncRep({
      svl: svlClient(mockFetch({
        captured,
        businesses: [{ id: 1, name: "Acme Corp" }],
      })),
      repId: "rep-7",
      tokenDir: "/tmp/tokens",
      mcpClientFactory: mockMcpClient([RECORDINGS[1]], { "rec-2": FILE_DETAILS["rec-2"] }),
      structuringFn: async () => ({
        summary: "Nobody there",
        interestLevel: "cool",
        objections: [],
        followUpItems: [],
      }),
      now: new Date("2026-06-23T16:00:00Z"),
    });

    assert.equal(result.processed, 1);
    const rec = result.recordings[0];
    assert.equal(rec.outcome, "voice_log");

    // No visit created
    assert.equal(captured.some((c) => c.path === "/api/visits"), false);

    // voice_log.imported event was logged
    const events = captured.filter((c) => c.path === "/api/agent/events");
    assert.equal(events.length, 1);
    assert.equal(events[0].body.type, "voice_log.imported");
    assert.equal(events[0].body.repId, "rep-7");
    assert.ok(events[0].body.payload.transcript);
  });

  it("skips recordings older than lastSync", async () => {
    const result = await syncRep({
      svl: svlClient(mockFetch({
        captured: [],
        businesses: [{ id: 1, name: "Acme Corp" }],
      })),
      repId: "rep-7",
      tokenDir: "/tmp/tokens",
      lastSync: "2026-06-23T14:30:00Z", // after rec-1, before rec-2
      mcpClientFactory: mockMcpClient(RECORDINGS, FILE_DETAILS),
      structuringFn: async () => null,
      now: new Date("2026-06-23T16:00:00Z"),
    });

    // rec-1 (14:00) filtered by lastSync; rec-2 (15:00) processed
    assert.equal(result.processed, 1);
    assert.equal(result.skipped, 1);
  });

  it("handles empty recording list gracefully", async () => {
    const result = await syncRep({
      svl: svlClient(mockFetch({
        captured: [],
        businesses: [{ id: 1, name: "Acme Corp" }],
      })),
      repId: "rep-7",
      tokenDir: "/tmp/tokens",
      mcpClientFactory: mockMcpClient([], {}),
      structuringFn: async () => null,
      now: new Date("2026-06-23T16:00:00Z"),
    });

    assert.equal(result.processed, 0);
    assert.equal(result.errors, 0);
    assert.equal(result.recordings.length, 0);
  });

  it("continues processing after a recording error", async () => {
    const badDetails: Record<string, PlaudFileDetail> = {
      "rec-1": FILE_DETAILS["rec-1"],
      "rec-2": FILE_DETAILS["rec-2"],
    };
    // Make getFile throw for rec-1
    const factory = (tokenDir: string): PlaudMcpClient =>
      ({
        async start() {},
        async stop() {},
        async listFiles() {
          return RECORDINGS;
        },
        async getFile(id: string) {
          if (id === "rec-1") throw new Error("Plaud API error");
          return badDetails[id];
        },
      }) as unknown as PlaudMcpClient;

    const result = await syncRep({
      svl: svlClient(mockFetch({
        captured: [],
        businesses: [{ id: 1, name: "Acme Corp" }],
      })),
      repId: "rep-7",
      tokenDir: "/tmp/tokens",
      mcpClientFactory: factory,
      structuringFn: async () => null,
      now: new Date("2026-06-23T16:00:00Z"),
    });

    assert.equal(result.processed, 2);
    assert.equal(result.errors, 1);

    const failed = result.recordings.find((r) => r.plaudId === "rec-1")!;
    assert.equal(failed.outcome, "error");
    assert.match(failed.error!, /Plaud API error/);

    const ok = result.recordings.find((r) => r.plaudId === "rec-2")!;
    assert.notEqual(ok.outcome, "error");
  });
});
