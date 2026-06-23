/**
 * Per-rep sync engine. Pulls new recordings from Plaud, structures transcripts,
 * matches businesses, creates visits + media rows in SVL.
 *
 * Pure functions (transcript joining, structuring prompt building, outcome
 * derivation) are exported for testing. The I/O orchestration is in runSync.
 */
import { PlaudMcpClient, type PlaudFileDetail, type PlaudRecording } from "./plaud-client";
import { SvlClient, type SvlBusiness } from "./svl-client";
import { matchBusiness, type BusinessMatchResult } from "./match";
import type { StructuredVisit } from "./types";

// ---------------------------------------------------------------------------
// Sync result types
// ---------------------------------------------------------------------------

export type SyncOutcome = "visit_created" | "voice_log" | "skipped" | "error";

export interface SyncRecordingResult {
  plaudId: string;
  name: string;
  outcome: SyncOutcome;
  visitId?: number;
  businessId?: number;
  businessName?: string;
  matchConfidence?: number;
  transcriptChars?: number;
  error?: string;
}

export interface SyncRepResult {
  repId: string;
  pulled: number;
  processed: number;
  skipped: number;
  errors: number;
  recordings: SyncRecordingResult[];
}

// ---------------------------------------------------------------------------
// Transcript helpers (pure)
// ---------------------------------------------------------------------------

/** Join Plaud transcript segments into a single string. */
export function joinTranscript(detail: PlaudFileDetail): string {
  if (!detail.source_list || detail.source_list.length === 0) return "";
  return detail.source_list
    .map((seg) => `${seg.speaker}: ${seg.text}`)
    .join("\n");
}

/**
 * Derive a visit outcome from the structured note's interest level.
 * Maps to the visit table's outcome field (neutral/positive/negative defaults).
 */
export function deriveOutcome(structured: StructuredVisit | null): string {
  if (!structured) return "neutral";
  switch (structured.interestLevel) {
    case "hot":
    case "warm":
      return "interested";
    case "cool":
    case "cold":
      return "not_interested";
    default:
      return "neutral";
  }
}

// ---------------------------------------------------------------------------
// Structuring via GPT-4o-mini (mirrors api-server transcription.ts)
// ---------------------------------------------------------------------------

const STRUCTURING_PROMPT = `You analyze transcripts of voice notes that a door-to-door sales rep records right after a business visit. Extract structured data. Respond with JSON only, matching this shape:
{
  "summary": "1-2 sentence summary of the visit",
  "interestLevel": "hot" | "warm" | "cool" | "cold" | "unknown",
  "objections": ["each objection the prospect raised"],
  "followUpItems": ["each concrete follow-up action mentioned"],
  "contactInfo": "any names/phones/emails mentioned, or omit",
  "nextStep": "the single most important next action, or omit",
  "businessName": "the name of the business visited if mentioned, or omit"
}`;

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

export async function structureTranscript(
  transcript: string,
): Promise<StructuredVisit | null> {
  if (!transcript.trim()) return null;
  const key = getApiKey();
  if (!key) return null;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: STRUCTURING_PROMPT },
        { role: "user", content: transcript },
      ],
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Structuring API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;

  const parsed = JSON.parse(content) as Partial<StructuredVisit>;
  return {
    summary: parsed.summary ?? "",
    interestLevel: parsed.interestLevel ?? "unknown",
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    followUpItems: Array.isArray(parsed.followUpItems) ? parsed.followUpItems : [],
    ...(parsed.contactInfo ? { contactInfo: parsed.contactInfo } : {}),
    ...(parsed.nextStep ? { nextStep: parsed.nextStep } : {}),
    ...(parsed.businessName ? { businessName: parsed.businessName } : {}),
  };
}

// ---------------------------------------------------------------------------
// Dedupe state
// ---------------------------------------------------------------------------

/**
 * Track which Plaud recordings we've already imported. Simple in-memory set
 * for a one-shot CLI run; for production, persist the last sync timestamp
 * per rep in the database.
 */
export function shouldImport(
  recording: PlaudRecording,
  lastSyncIso: string | null,
): boolean {
  if (!lastSyncIso) return true;
  return recording.created_at > lastSyncIso;
}

// ---------------------------------------------------------------------------
// Core sync orchestration
// ---------------------------------------------------------------------------

export interface SyncOptions {
  svl: SvlClient;
  repId: string;
  tokenDir: string;
  /** ISO timestamp of last sync (only pull recordings after this). */
  lastSync?: string | null;
  /** Injectable for testing. */
  mcpClientFactory?: (tokenDir: string) => PlaudMcpClient;
  /** Injectable for testing. */
  structuringFn?: (transcript: string) => Promise<StructuredVisit | null>;
  /** Injectable for testing. */
  now?: Date;
}

export async function syncRep(opts: SyncOptions): Promise<SyncRepResult> {
  const now = opts.now ?? new Date();
  const recordings: SyncRecordingResult[] = [];
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  // Fetch businesses for matching
  let businesses: SvlBusiness[];
  try {
    businesses = await opts.svl.getBusinesses();
  } catch (err) {
    return {
      repId: opts.repId,
      pulled: 0,
      processed: 0,
      skipped: 0,
      errors: 1,
      recordings: [{
        plaudId: "n/a",
        name: "fetch-businesses",
        outcome: "error",
        error: err instanceof Error ? err.message : String(err),
      }],
    };
  }

  // Start MCP client for this rep
  const mcp = opts.mcpClientFactory
    ? opts.mcpClientFactory(opts.tokenDir)
    : new PlaudMcpClient(opts.tokenDir);

  try {
    await mcp.start();

    // Pull recordings since last sync
    const dateFrom = opts.lastSync?.slice(0, 10);
    const files = await mcp.listFiles({ dateFrom });

    for (const file of files) {
      if (!shouldImport(file, opts.lastSync ?? null)) {
        skipped++;
        continue;
      }

      try {
        const result = await processRecording(file, {
          mcp,
          svl: opts.svl,
          repId: opts.repId,
          businesses,
          structuringFn: opts.structuringFn ?? structureTranscript,
        });
        recordings.push(result);
        processed++;
        if (result.outcome === "error") errors++;
      } catch (err) {
        recordings.push({
          plaudId: file.id,
          name: file.name,
          outcome: "error",
          error: err instanceof Error ? err.message : String(err),
        });
        errors++;
        processed++;
      }
    }
  } finally {
    await mcp.stop();
  }

  return {
    repId: opts.repId,
    pulled: recordings.length + skipped,
    processed,
    skipped,
    errors,
    recordings,
  };
}

async function processRecording(
  file: PlaudRecording,
  ctx: {
    mcp: PlaudMcpClient;
    svl: SvlClient;
    repId: string;
    businesses: SvlBusiness[];
    structuringFn: (transcript: string) => Promise<StructuredVisit | null>;
  },
): Promise<SyncRecordingResult> {
  // Get full transcript + notes
  const detail = await ctx.mcp.getFile(file.id);
  const transcript = joinTranscript(detail);
  const transcriptChars = transcript.length;

  if (transcriptChars === 0) {
    return {
      plaudId: file.id,
      name: file.name,
      outcome: "skipped",
      transcriptChars: 0,
    };
  }

  // Structure with GPT-4o-mini
  let structured: StructuredVisit | null = null;
  try {
    structured = await ctx.structuringFn(transcript);
  } catch {
    // Structuring failure is non-fatal; we still have the transcript
  }

  // Match business: try structured businessName first, then fuzzy transcript match
  let match: BusinessMatchResult | null = null;
  if (structured?.businessName) {
    match = matchBusiness(structured.businessName, ctx.businesses, 0.5);
  }
  if (!match) {
    match = matchBusiness(transcript, ctx.businesses);
  }

  const outcome = deriveOutcome(structured);
  const aiStructured = structured ? {
    summary: structured.summary,
    interestLevel: structured.interestLevel,
    objections: structured.objections,
    followUpItems: structured.followUpItems,
    ...(structured.contactInfo ? { contactInfo: structured.contactInfo } : {}),
    ...(structured.nextStep ? { nextStep: structured.nextStep } : {}),
  } : null;

  if (match) {
    // Create visit + media row
    const visit = await ctx.svl.createVisit({
      businessId: match.businessId,
      repId: ctx.repId,
      outcome,
      visitedAt: file.start_at ?? file.created_at,
    });

    await ctx.svl.createMedia({
      visitId: visit.id,
      type: "voice_note",
      url: detail.presigned_url ?? `plaud://${file.id}`,
      filename: file.name,
      mimeType: "audio/m4a",
      transcriptionStatus: "done",
      transcript,
      aiStructured: aiStructured ?? undefined,
    });

    await ctx.svl.logEvent({
      type: "media.transcribed",
      entityType: "media",
      businessId: match.businessId,
      visitId: visit.id,
      repId: ctx.repId,
      payload: {
        source: "plaud",
        plaudId: file.id,
        interestLevel: structured?.interestLevel,
        objectionCount: structured?.objections.length ?? 0,
        followUpCount: structured?.followUpItems.length ?? 0,
        transcriptChars,
        matchConfidence: match.confidence,
      },
    });

    return {
      plaudId: file.id,
      name: file.name,
      outcome: "visit_created",
      visitId: visit.id,
      businessId: match.businessId,
      businessName: match.name,
      matchConfidence: match.confidence,
      transcriptChars,
    };
  }

  // No business match -- store as voice log event (no visit, no media row
  // since media requires a visitId). The transcript is still available in
  // the event payload for coaching to read.
  await ctx.svl.logEvent({
    type: "voice_log.imported",
    repId: ctx.repId,
    payload: {
      source: "plaud",
      plaudId: file.id,
      name: file.name,
      transcript: transcript.slice(0, 4000),
      transcriptChars,
      summary: structured?.summary,
      interestLevel: structured?.interestLevel,
      objections: structured?.objections,
      followUpItems: structured?.followUpItems,
      durationMs: file.duration,
    },
  });

  return {
    plaudId: file.id,
    name: file.name,
    outcome: "voice_log",
    transcriptChars,
  };
}
