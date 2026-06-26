/**
 * Tests for LLM-powered coaching generation (llm.ts).
 * Uses injected fetch mocks - no real network calls.
 */
import assert from "node:assert/strict"
import { afterEach, beforeEach, describe, it } from "node:test"
import { generateCoachingSuggestion, type CoachingNoteData } from "../src/llm"

const SAMPLE_NOTE: CoachingNoteData = {
  businessName: "Johnson HVAC",
  interestLevel: "hot",
  summary: "Owner is frustrated with current AC unit, wants quote ASAP",
  nextStep: "Send quote by Friday",
  followUpItems: ["Get unit model number", "Check warranty status"],
  objections: ["Price seems high"],
  contactInfo: "Mike 404-555-0100",
  callbackMissing: true,
}

const COMPILED_COACHING = "Grounding preamble.\n\nErica playbook: be urgent and commission-focused."

const VALID_RESPONSE = JSON.stringify({
  choices: [
    {
      message: {
        content: JSON.stringify({
          title: "Johnson HVAC is hot - send that quote TODAY",
          body: "Mike is frustrated and ready to buy. You named Friday - that is too slow.\n\nCall him back with the quote today. Every hour you wait, a competitor gets a shot.\n\nHandle the price objection: anchor on value, not cost.",
        }),
      },
    },
  ],
})

function mockFetchOk(content: string): typeof fetch {
  return (async () =>
    new Response(content, {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch
}

function mockFetchError(status: number, body: string): typeof fetch {
  return (async () => new Response(body, { status })) as unknown as typeof fetch
}

describe("generateCoachingSuggestion", () => {
  const origKey = process.env.OPENAI_API_KEY
  const origModel = process.env.COACHING_LLM_MODEL

  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key"
    delete process.env.COACHING_LLM_MODEL
  })

  afterEach(() => {
    if (origKey !== undefined) process.env.OPENAI_API_KEY = origKey
    else delete process.env.OPENAI_API_KEY
    if (origModel !== undefined) process.env.COACHING_LLM_MODEL = origModel
    else delete process.env.COACHING_LLM_MODEL
  })

  it("returns { title, body } on a successful LLM response", async () => {
    const result = await generateCoachingSuggestion(
      SAMPLE_NOTE,
      COMPILED_COACHING,
      mockFetchOk(VALID_RESPONSE),
    )
    assert.ok(result)
    assert.equal(result!.title, "Johnson HVAC is hot - send that quote TODAY")
    assert.ok(result!.body.length > 0)
    assert.ok(result!.body.includes("Mike"))
  })

  it("returns null when OPENAI_API_KEY is not set", async () => {
    delete process.env.OPENAI_API_KEY
    const result = await generateCoachingSuggestion(
      SAMPLE_NOTE,
      COMPILED_COACHING,
      mockFetchOk(VALID_RESPONSE),
    )
    assert.equal(result, null)
  })

  it("returns null when fetch throws", async () => {
    const throwingFetch = (async () => {
      throw new Error("network unreachable")
    }) as unknown as typeof fetch
    const result = await generateCoachingSuggestion(
      SAMPLE_NOTE,
      COMPILED_COACHING,
      throwingFetch,
    )
    assert.equal(result, null)
  })

  it("returns null on non-OK HTTP status", async () => {
    const result = await generateCoachingSuggestion(
      SAMPLE_NOTE,
      COMPILED_COACHING,
      mockFetchError(429, "rate limited"),
    )
    assert.equal(result, null)
  })

  it("returns null when response JSON is missing choices", async () => {
    const result = await generateCoachingSuggestion(
      SAMPLE_NOTE,
      COMPILED_COACHING,
      mockFetchOk(JSON.stringify({ id: "x" })),
    )
    assert.equal(result, null)
  })

  it("returns null when content is not valid JSON", async () => {
    const badResponse = JSON.stringify({
      choices: [{ message: { content: "not json at all" } }],
    })
    const result = await generateCoachingSuggestion(
      SAMPLE_NOTE,
      COMPILED_COACHING,
      mockFetchOk(badResponse),
    )
    assert.equal(result, null)
  })

  it("returns null when content JSON is missing title or body", async () => {
    const missingField = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ title: "has title" }) } }],
    })
    const result = await generateCoachingSuggestion(
      SAMPLE_NOTE,
      COMPILED_COACHING,
      mockFetchOk(missingField),
    )
    assert.equal(result, null)
  })

  it("returns null when title or body are empty strings", async () => {
    const emptyFields = JSON.stringify({
      choices: [{ message: { content: JSON.stringify({ title: "", body: "" }) } }],
    })
    const result = await generateCoachingSuggestion(
      SAMPLE_NOTE,
      COMPILED_COACHING,
      mockFetchOk(emptyFields),
    )
    assert.equal(result, null)
  })

  it("works with empty compiledCoaching (no profile resolved)", async () => {
    const result = await generateCoachingSuggestion(
      SAMPLE_NOTE,
      "",
      mockFetchOk(VALID_RESPONSE),
    )
    assert.ok(result)
    assert.ok(result!.title.length > 0)
  })

  it("uses COACHING_LLM_MODEL env var when set", async () => {
    process.env.COACHING_LLM_MODEL = "gpt-4o"
    let capturedBody: any
    const capturingFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init!.body))
      return new Response(VALID_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    await generateCoachingSuggestion(SAMPLE_NOTE, COMPILED_COACHING, capturingFetch)
    assert.equal(capturedBody.model, "gpt-4o")
  })

  it("defaults to gpt-4o-mini when COACHING_LLM_MODEL not set", async () => {
    let capturedBody: any
    const capturingFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init!.body))
      return new Response(VALID_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    await generateCoachingSuggestion(SAMPLE_NOTE, COMPILED_COACHING, capturingFetch)
    assert.equal(capturedBody.model, "gpt-4o-mini")
  })

  it("uses temperature 0.4", async () => {
    let capturedBody: any
    const capturingFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init!.body))
      return new Response(VALID_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    await generateCoachingSuggestion(SAMPLE_NOTE, COMPILED_COACHING, capturingFetch)
    assert.equal(capturedBody.temperature, 0.4)
  })

  it("includes compiledCoaching in the system message", async () => {
    let capturedBody: any
    const capturingFetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init!.body))
      return new Response(VALID_RESPONSE, {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }) as unknown as typeof fetch

    await generateCoachingSuggestion(SAMPLE_NOTE, COMPILED_COACHING, capturingFetch)
    const sysMsg = capturedBody.messages.find((m: any) => m.role === "system")
    assert.ok(sysMsg)
    assert.match(sysMsg.content, /Erica playbook/)
    assert.match(sysMsg.content, /sales coach/)
  })
})
