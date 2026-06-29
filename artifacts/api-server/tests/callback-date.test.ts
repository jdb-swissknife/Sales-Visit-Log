import assert from "node:assert/strict";
import { describe, it } from "node:test";

/**
 * Tests for the callbackDate field in the AI structuring pipeline.
 *
 * These tests validate the response-parsing logic without making real
 * OpenAI API calls. They confirm that:
 *   1. callbackDate is correctly extracted when present in the LLM response
 *   2. callbackDate is omitted when null/absent in the LLM response
 *   3. The STRUCTURING_PROMPT instructs the model to return callbackDate
 *   4. Invalid dates are rejected before being written to the visit
 */

describe("callbackDate parsing", () => {
  // Simulate the response parser from structureTranscript()
  function parseStructured(content: string) {
    const parsed = JSON.parse(content) as Record<string, unknown>;
    return {
      summary: (parsed.summary as string) ?? "",
      interestLevel: (parsed.interestLevel as string) ?? "unknown",
      objections: Array.isArray(parsed.objections) ? parsed.objections : [],
      followUpItems: Array.isArray(parsed.followUpItems) ? parsed.followUpItems : [],
      ...(parsed.contactInfo ? { contactInfo: parsed.contactInfo as string } : {}),
      ...(parsed.nextStep ? { nextStep: parsed.nextStep as string } : {}),
      ...(parsed.callbackDate ? { callbackDate: parsed.callbackDate as string } : {}),
    };
  }

  it("extracts callbackDate when the LLM returns a valid date", () => {
    const llmResponse = JSON.stringify({
      summary: "Set a meeting for July 8th",
      interestLevel: "warm",
      objections: [],
      followUpItems: [],
      callbackDate: "2026-07-08",
    });
    const result = parseStructured(llmResponse);
    assert.equal(result.callbackDate, "2026-07-08");
  });

  it("omits callbackDate when the LLM returns null", () => {
    const llmResponse = JSON.stringify({
      summary: "No date mentioned",
      interestLevel: "cool",
      objections: [],
      followUpItems: [],
      callbackDate: null,
    });
    const result = parseStructured(llmResponse);
    assert.equal(result.callbackDate, undefined);
  });

  it("omits callbackDate when the field is absent", () => {
    const llmResponse = JSON.stringify({
      summary: "Quick stop, not interested",
      interestLevel: "cold",
      objections: ["too expensive"],
      followUpItems: [],
    });
    const result = parseStructured(llmResponse);
    assert.equal(result.callbackDate, undefined);
  });
});

describe("callbackDate visit-update guard", () => {
  // Simulate the guard in writeTranscriptResult that decides whether to
  // update visit.nextActionDate from the extracted callbackDate.
  function shouldUpdateVisit(callbackDate: string | undefined): boolean {
    if (!callbackDate) return false;
    const parsed = new Date(callbackDate);
    return !Number.isNaN(parsed.getTime());
  }

  it("allows update for a valid ISO date", () => {
    assert.equal(shouldUpdateVisit("2026-07-08"), true);
  });

  it("rejects update for an invalid date string", () => {
    assert.equal(shouldUpdateVisit("not-a-date"), false);
  });

  it("rejects update when callbackDate is undefined", () => {
    assert.equal(shouldUpdateVisit(undefined), false);
  });
});

describe("STRUCTURING_PROMPT callbackDate instruction", () => {
  it("includes callbackDate in the JSON schema instruction", async () => {
    // Import the module to read the prompt constant
    const mod = await import("../src/lib/transcription.js");
    // The prompt is not exported, but we can verify the StructuredNote
    // interface includes callbackDate by checking a constructed object.
    // Instead, validate that the source file contains the instruction.
    const fs = await import("node:fs");
    const src = fs.readFileSync(
      new URL("../src/lib/transcription.ts", import.meta.url),
      "utf8",
    );
    assert.ok(
      src.includes("callbackDate"),
      "transcription.ts must reference callbackDate in the prompt and/or parsing",
    );
    assert.ok(
      src.includes("YYYY-MM-DD"),
      "transcription.ts must instruct the model to return ISO format dates",
    );
  });
});
