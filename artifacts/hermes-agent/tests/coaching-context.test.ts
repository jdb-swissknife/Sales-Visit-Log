/**
 * Tests for the HermesAgent coaching-context surface:
 *   1. HermesClient.getCoachingContext hits the correct URL with repId
 *   2. HermesClient.getCoachingContext omits repId when not provided
 *   3. mergeCoachingMetadata attaches profile metadata when context is present
 *   4. mergeCoachingMetadata sets coachingContextApplied=false when context is null
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HermesClient } from "../src/client";
import { mergeCoachingMetadata } from "../src/run-webhook";
import type { ResolvedCoachingContext } from "../src/types";

function makeFetch(captured: { path: string; query: URLSearchParams }): typeof fetch {
  return (async (url: string | URL) => {
    const u = new URL(String(url));
    captured.path = u.pathname;
    captured.query = u.searchParams;
    const payload: ResolvedCoachingContext = {
      profile: null,
      instructions: { transcript: null, coaching: null },
      knowledgeDocs: [],
      methodTags: [],
      compiled: { transcript: "", coaching: "" },
    };
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

describe("HermesClient.getCoachingContext", () => {
  it("hits /api/agent/coaching-context?repId=... when repId is provided", async () => {
    const captured: { path: string; query: URLSearchParams } = {
      path: "",
      query: new URLSearchParams(),
    };
    const c = client(makeFetch(captured));
    await c.getCoachingContext({ repId: "rep-7" });
    assert.equal(captured.path, "/api/agent/coaching-context");
    assert.equal(captured.query.get("repId"), "rep-7");
  });

  it("hits /api/agent/coaching-context (no query) when repId is omitted", async () => {
    const captured: { path: string; query: URLSearchParams } = {
      path: "",
      query: new URLSearchParams(),
    };
    const c = client(makeFetch(captured));
    await c.getCoachingContext({});
    assert.equal(captured.path, "/api/agent/coaching-context");
    assert.equal(captured.query.get("repId"), null);
  });
});

describe("mergeCoachingMetadata", () => {
  const baseData = { eventId: "evt-1", visitId: 42, interestLevel: "hot" };

  it("attaches full profile metadata when context is present", () => {
    const ctx: ResolvedCoachingContext = {
      profile: {
        id: 7,
        name: "Erica HVAC Playbook",
        scopeType: "rep",
        scopeKey: "rep-7",
      },
      instructions: { transcript: null, coaching: null },
      knowledgeDocs: [
        { id: 101, title: "Leader Playbook", sourceType: "leader_playbook", methodTag: "erica", sortOrder: 100, body: "..." },
        { id: 102, title: "Objection Library", sourceType: "objection_library", methodTag: "erica", sortOrder: 200, body: "..." },
      ],
      methodTags: ["erica"],
      compiled: { transcript: "...", coaching: "..." },
    };

    const result = mergeCoachingMetadata(baseData, ctx);
    assert.equal(result.coachingContextApplied, true);
    assert.equal(result.coachingProfileId, 7);
    assert.equal(result.coachingProfileName, "Erica HVAC Playbook");
    assert.equal(result.coachingProfileScopeType, "rep");
    assert.equal(result.coachingProfileScopeKey, "rep-7");
    assert.deepEqual(result.coachingMethodTags, ["erica"]);
    assert.deepEqual(result.coachingKnowledgeDocIds, [101, 102]);
    assert.deepEqual(result.coachingKnowledgeDocTitles, ["Leader Playbook", "Objection Library"]);
    // Original data preserved
    assert.equal(result.eventId, "evt-1");
    assert.equal(result.visitId, 42);
  });

  it("sets coachingContextApplied=false when context is null", () => {
    const result = mergeCoachingMetadata(baseData, null);
    assert.equal(result.coachingContextApplied, false);
    assert.equal(result.coachingProfileId, undefined);
    assert.equal(result.coachingProfileName, undefined);
    // Original data preserved
    assert.equal(result.eventId, "evt-1");
    assert.equal(result.visitId, 42);
  });

  it("sets coachingContextApplied=false when profile is null", () => {
    const ctx: ResolvedCoachingContext = {
      profile: null,
      instructions: { transcript: null, coaching: null },
      knowledgeDocs: [],
      methodTags: [],
      compiled: { transcript: "", coaching: "" },
    };
    const result = mergeCoachingMetadata(baseData, ctx);
    assert.equal(result.coachingContextApplied, false);
    assert.equal(result.coachingProfileId, undefined);
  });

  it("does not mutate the original data object", () => {
    const ctx: ResolvedCoachingContext = {
      profile: { id: 1, name: "Test", scopeType: "global", scopeKey: "default" },
      instructions: { transcript: null, coaching: null },
      knowledgeDocs: [],
      methodTags: [],
      compiled: { transcript: "", coaching: "" },
    };
    const result = mergeCoachingMetadata(baseData, ctx);
    assert.equal((baseData as Record<string, unknown>).coachingContextApplied, undefined);
    assert.notEqual(result, baseData);
  });
});
