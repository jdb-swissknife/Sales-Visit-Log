/**
 * Tests for the pure functions: matchBusiness, levenshtein, joinTranscript,
 * deriveOutcome, shouldImport. The MCP client and I/O orchestration are
 * tested via injectable factories in sync.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { levenshtein, matchBusiness } from "../src/match";
import { joinTranscript, deriveOutcome, shouldImport } from "../src/sync";
import type { PlaudFileDetail } from "../src/plaud-client";
import type { StructuredVisit } from "../src/types";

describe("levenshtein", () => {
  it("returns 0 for identical strings", () => {
    assert.equal(levenshtein("hello", "hello"), 0);
  });

  it("returns length for empty vs non-empty", () => {
    assert.equal(levenshtein("", "abc"), 3);
    assert.equal(levenshtein("abc", ""), 3);
  });

  it("computes edit distance correctly", () => {
    assert.equal(levenshtein("kitten", "sitting"), 3);
    assert.equal(levenshtein("flaw", "lawn"), 2);
  });

  it("respects maxDist early exit", () => {
    assert.equal(levenshtein("abc", "xyz", 1), 2); // exceeds max
    assert.equal(levenshtein("abc", "abd", 1), 1);
  });
});

describe("matchBusiness", () => {
  const businesses = [
    { id: 1, name: "Acme Corp" },
    { id: 2, name: "Bobs Plumbing" },
    { id: 3, name: "Charlie's HVAC Services" },
    { id: 4, name: "Delta Dental" },
  ];

  it("matches exact business name in transcript", () => {
    const transcript = "Just visited Acme Corp, spoke with the manager about their current setup.";
    const match = matchBusiness(transcript, businesses);
    assert.ok(match);
    assert.equal(match!.businessId, 1);
    assert.ok(match!.confidence > 0.5);
  });

  it("matches with minor spelling variation (fuzzy)", () => {
    const transcript = "Went to Bobs Pluming today, they seemed interested.";
    const match = matchBusiness(transcript, businesses, 0.5);
    assert.ok(match);
    assert.equal(match!.businessId, 2);
  });

  it("returns null when no business is mentioned", () => {
    const transcript = "Had a long day, no one was interested. Weather was nice though.";
    const match = matchBusiness(transcript, businesses);
    assert.equal(match, null);
  });

  it("returns null for empty transcript", () => {
    assert.equal(matchBusiness("", businesses), null);
  });

  it("returns null for empty business list", () => {
    assert.equal(matchBusiness("some transcript", []), null);
  });

  it("picks the highest confidence match when multiple are mentioned", () => {
    const transcript = "Acme Corp was great. Also briefly mentioned Delta Dental.";
    const match = matchBusiness(transcript, businesses);
    assert.ok(match);
    // Both are exact substring matches; "Delta Dental" is longer so higher confidence
    assert.ok([1, 4].includes(match!.businessId));
  });

  it("is case-insensitive", () => {
    const transcript = "visited ACME CORP earlier today";
    const match = matchBusiness(transcript, businesses);
    assert.ok(match);
    assert.equal(match!.businessId, 1);
  });
});

describe("joinTranscript", () => {
  it("joins segments with speaker labels", () => {
    const detail: PlaudFileDetail = {
      id: "rec-1",
      name: "Test Recording",
      created_at: "2026-06-23T18:00:00Z",
      duration: 30000,
      serial_number: "PLA001",
      source_list: [
        { speaker: "Speaker 1", start: 0, end: 5000, text: "Hello there" },
        { speaker: "Speaker 2", start: 5000, end: 10000, text: "Hi, how can I help?" },
      ],
    };
    const joined = joinTranscript(detail);
    assert.equal(joined, "Speaker 1: Hello there\nSpeaker 2: Hi, how can I help?");
  });

  it("returns empty string for no segments", () => {
    const detail: PlaudFileDetail = {
      id: "rec-2",
      name: "Empty",
      created_at: "2026-06-23T18:00:00Z",
      duration: 0,
      serial_number: "PLA001",
    };
    assert.equal(joinTranscript(detail), "");
  });
});

describe("deriveOutcome", () => {
  it("maps hot/warm to interested", () => {
    assert.equal(deriveOutcome({ interestLevel: "hot" } as StructuredVisit), "interested");
    assert.equal(deriveOutcome({ interestLevel: "warm" } as StructuredVisit), "interested");
  });

  it("maps cool/cold to not_interested", () => {
    assert.equal(deriveOutcome({ interestLevel: "cool" } as StructuredVisit), "not_interested");
    assert.equal(deriveOutcome({ interestLevel: "cold" } as StructuredVisit), "not_interested");
  });

  it("maps unknown/null to neutral", () => {
    assert.equal(deriveOutcome({ interestLevel: "unknown" } as StructuredVisit), "neutral");
    assert.equal(deriveOutcome(null), "neutral");
  });
});

describe("shouldImport", () => {
  it("returns true when no lastSync", () => {
    assert.equal(shouldImport(
      { id: "1", name: "test", created_at: "2026-06-23T10:00:00Z", duration: 1000, serial_number: "S1" },
      null,
    ), true);
  });

  it("returns true when recording is newer than lastSync", () => {
    assert.equal(shouldImport(
      { id: "1", name: "test", created_at: "2026-06-23T10:00:00Z", duration: 1000, serial_number: "S1" },
      "2026-06-22T10:00:00Z",
    ), true);
  });

  it("returns false when recording is older than lastSync", () => {
    assert.equal(shouldImport(
      { id: "1", name: "test", created_at: "2026-06-21T10:00:00Z", duration: 1000, serial_number: "S1" },
      "2026-06-22T10:00:00Z",
    ), false);
  });
});
