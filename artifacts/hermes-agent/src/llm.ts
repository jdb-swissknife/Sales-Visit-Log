/**
 * LLM-powered coaching suggestion generation.
 *
 * Uses the raw OpenAI Chat Completions API (fetch, no SDK) matching the
 * pattern in api-server/src/lib/transcription.ts. The model is configurable
 * via COACHING_LLM_MODEL (default gpt-4o-mini).
 *
 * Every failure path returns null so the caller can fall back to the
 * deterministic hardcoded coaching. This function never throws.
 */

export interface CoachingNoteData {
  businessName: string
  interestLevel: string
  summary: string
  nextStep: string
  followUpItems: string[]
  objections: string[]
  contactInfo: string
  callbackMissing: boolean
}

export interface CoachingSuggestion {
  title: string
  body: string
}

const OPENAI_BASE = "https://api.openai.com/v1"
const TIMEOUT_MS = 15_000

const SYSTEM_SUFFIX =
  'You are a sales coach. Write a coaching card for a door-to-door rep based ' +
  'on the visit data below. Be urgent, specific, and action-oriented. ' +
  'Respond with JSON: {"title": "...", "body": "..."}. ' +
  "Title max 100 chars. Body max 1000 chars. Use newlines for paragraphs."

/**
 * Generate a coaching title + body from structured note data using the
 * coaching profile's compiled context as system prompt.
 *
 * @param data Structured note fields extracted from the transcript
 * @param compiledCoaching The compiled.coaching string from the resolved
 *   coaching context (grounding preamble + instructions + doc bodies).
 *   Pass empty string when no profile is resolved.
 * @param fetchImpl Optional injectable fetch (for tests)
 * @returns { title, body } on success, null on any failure
 */
export async function generateCoachingSuggestion(
  data: CoachingNoteData,
  compiledCoaching: string,
  fetchImpl?: typeof fetch,
): Promise<CoachingSuggestion | null> {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) return null

  const model = process.env.COACHING_LLM_MODEL ?? "gpt-4o-mini"
  const systemMessage = compiledCoaching
    ? `${compiledCoaching}\n\n${SYSTEM_SUFFIX}`
    : SYSTEM_SUFFIX

  const userMessage = JSON.stringify(
    {
      businessName: data.businessName,
      interestLevel: data.interestLevel,
      summary: data.summary,
      nextStep: data.nextStep,
      followUpItems: data.followUpItems,
      objections: data.objections,
      contactInfo: data.contactInfo,
      callbackMissing: data.callbackMissing,
    },
    null,
    2,
  )

  const doFetch = fetchImpl ?? fetch

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const res = await doFetch(`${OPENAI_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        temperature: 0.4,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: systemMessage },
          { role: "user", content: userMessage },
        ],
      }),
      signal: controller.signal,
    })

    clearTimeout(timeout)

    if (!res.ok) {
      const body = await res.text().catch(() => "")
      console.warn(`Coaching LLM error ${res.status}: ${body.slice(0, 300)}`)
      return null
    }

    const json = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>
    }
    const content = json.choices?.[0]?.message?.content
    if (!content) return null

    const parsed = JSON.parse(content) as Partial<CoachingSuggestion>
    if (typeof parsed.title !== "string" || typeof parsed.body !== "string") return null
    if (!parsed.title.trim() || !parsed.body.trim()) return null

    return {
      title: parsed.title.slice(0, 200),
      body: parsed.body.slice(0, 5000),
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.includes("abort")) {
      console.warn("Coaching LLM timed out (15s)")
    } else {
      console.warn(`Coaching LLM call failed: ${msg}`)
    }
    return null
  }
}
