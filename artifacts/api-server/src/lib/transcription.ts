import { eq } from "drizzle-orm";
import { db, mediaTable, visitsTable } from "@workspace/db";
import { logger } from "./logger";
import { logEvent } from "./events";
import { downloadObjectBuffer } from "./objectStorage";
import { resolveCoachingContext } from "./coaching-context";

const OPENAI_BASE = "https://api.openai.com/v1";
const WHISPER_MODEL = "whisper-1";
const STRUCTURING_MODEL = "gpt-4o-mini";

export interface StructuredNote {
  summary: string;
  interestLevel: "hot" | "warm" | "cool" | "cold" | "unknown";
  objections: string[];
  followUpItems: string[];
  contactInfo?: string;
  nextStep?: string;
  callbackDate?: string; // ISO date (YYYY-MM-DD) when a meeting/callback/follow-up is mentioned
}

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

export function isTranscriptionConfigured(): boolean {
  return getApiKey() !== null;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isPlainTextTranscriptFile(opts: { filename?: string | null; mimeType?: string | null }): boolean {
  const filename = opts.filename?.toLowerCase() ?? "";
  const mimeType = opts.mimeType?.toLowerCase() ?? "";
  return mimeType.startsWith("text/") || filename.endsWith(".txt");
}

function bufferToTranscriptText(buffer: Buffer): string {
  return buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
}

async function getVisitMeta(visitId: number | null) {
  if (!visitId) return null;
  return (
    await db
      .select({ repId: visitsTable.repId, businessId: visitsTable.businessId })
      .from(visitsTable)
      .where(eq(visitsTable.id, visitId))
  )[0] ?? null;
}

async function writeTranscriptResult(opts: {
  mediaId: number;
  visitId: number | null;
  transcript: string;
  structured: StructuredNote | null;
  transcriptionError: string | null;
  source: "audio" | "text";
}) {
  const visitMeta = await getVisitMeta(opts.visitId);

  await db
    .update(mediaTable)
    .set({
      transcript: opts.transcript,
      aiStructured: opts.structured,
      transcriptionStatus: "done",
      transcriptionError: opts.transcriptionError,
    })
    .where(eq(mediaTable.id, opts.mediaId));

  // If AI extracted a callback date, set it on the visit.
  if (opts.structured?.callbackDate && opts.visitId) {
    const parsed = new Date(opts.structured.callbackDate);
    if (!Number.isNaN(parsed.getTime())) {
      await db
        .update(visitsTable)
        .set({ nextActionDate: parsed })
        .where(eq(visitsTable.id, opts.visitId));
    }
  }

  await logEvent({
    type: "media.transcribed",
    entityType: "media",
    entityId: opts.mediaId,
    businessId: visitMeta?.businessId ?? null,
    visitId: opts.visitId,
    repId: visitMeta?.repId ?? null,
    payload: {
      source: opts.source,
      summary: opts.structured?.summary,
      interestLevel: opts.structured?.interestLevel,
      objections: opts.structured?.objections ?? [],
      followUpItems: opts.structured?.followUpItems ?? [],
      nextStep: opts.structured?.nextStep,
      contactInfo: opts.structured?.contactInfo,
      callbackDate: opts.structured?.callbackDate,
      objectionCount: opts.structured?.objections.length ?? 0,
      followUpCount: opts.structured?.followUpItems.length ?? 0,
      transcriptChars: opts.transcript.length,
      transcriptionError: opts.transcriptionError,
    },
  });
}

async function transcribeAudio(
  audio: Buffer,
  filename: string,
  mimeType: string,
): Promise<string> {
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(audio)], { type: mimeType }), filename);
  form.append("model", WHISPER_MODEL);
  form.append("response_format", "json");

  const res = await fetch(`${OPENAI_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${getApiKey()}` },
    body: form,
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Whisper API error ${res.status}: ${body.slice(0, 300)}`);
  }

  const data = (await res.json()) as { text?: string };
  return data.text ?? "";
}

const STRUCTURING_PROMPT = `You analyze transcripts of voice notes that a door-to-door sales rep records right after a business visit. Extract structured data.

Today's date is provided as context. When the rep mentions a date for a meeting, callback, appointment, or follow-up (e.g., "Jul 8th", "January 15", "next Friday", "the 23rd", "end of next week"), convert it to an ISO calendar date (YYYY-MM-DD). If the rep says "I set a meeting" or "scheduled a callback" but gives no date, set callbackDate to null.

Respond with JSON only, matching this shape:
{
  "summary": "1-2 sentence summary of the visit",
  "interestLevel": "hot" | "warm" | "cool" | "cold" | "unknown",
  "objections": ["each objection the prospect raised"],
  "followUpItems": ["each concrete follow-up action mentioned"],
  "contactInfo": "any names/phones/emails mentioned, or omit",
  "nextStep": "the single most important next action, or omit",
  "callbackDate": "YYYY-MM-DD or null"
}`;

async function structureTranscript(
  transcript: string,
  systemPrompt: string = STRUCTURING_PROMPT,
): Promise<StructuredNote | null> {
  if (!transcript.trim()) return null;

  const res = await fetch(`${OPENAI_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: STRUCTURING_MODEL,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n${transcript}` },
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

  const parsed = JSON.parse(content) as Partial<StructuredNote>;
  return {
    summary: parsed.summary ?? "",
    interestLevel: parsed.interestLevel ?? "unknown",
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    followUpItems: Array.isArray(parsed.followUpItems) ? parsed.followUpItems : [],
    ...(parsed.contactInfo ? { contactInfo: parsed.contactInfo } : {}),
    ...(parsed.nextStep ? { nextStep: parsed.nextStep } : {}),
    ...(parsed.callbackDate ? { callbackDate: parsed.callbackDate } : {}),
  };
}

async function buildStructuredTranscript(
  transcript: string,
  repId?: string | null,
): Promise<{
  structured: StructuredNote | null;
  transcriptionError: string | null;
}> {
  if (!transcript.trim()) {
    return {
      structured: null,
      transcriptionError: "Transcript file was empty",
    };
  }

  if (!isTranscriptionConfigured()) {
    return {
      structured: null,
      transcriptionError: "AI summary not configured (OPENAI_API_KEY missing)",
    };
  }

  // Resolve coaching context to enrich the system prompt with profile-specific
  // transcript instructions (e.g., sharper buyer-stage labels for HVAC).
  // Graceful fallback: if resolution fails, use the default prompt unchanged.
  let systemPrompt = STRUCTURING_PROMPT;
  if (repId) {
    try {
      const ctx = await resolveCoachingContext(repId);
      if (ctx.compiled.transcript) {
        systemPrompt = `${ctx.compiled.transcript}\n\n${STRUCTURING_PROMPT}`;
      }
    } catch {
      // Swallow: use default structuring prompt
    }
  }

  try {
    const structured = await structureTranscript(transcript, systemPrompt);
    return { structured, transcriptionError: null };
  } catch (err) {
    return {
      structured: null,
      transcriptionError: getErrorMessage(err).slice(0, 500),
    };
  }
}

/**
 * Transcribe + structure a voice media item, updating the row as it goes.
 * Designed to be called fire-and-forget after upload; never throws.
 *
 * @param audio Optional in-memory audio (used right after upload to skip a
 *              round-trip to object storage). Falls back to downloading.
 */
export async function processMediaTranscription(
  mediaId: number,
  audio?: { buffer: Buffer; filename: string; mimeType: string },
): Promise<void> {
  if (!isTranscriptionConfigured()) {
    logger.warn({ mediaId }, "OPENAI_API_KEY not set; skipping transcription");
    await db
      .update(mediaTable)
      .set({ transcriptionStatus: "error", transcriptionError: "Transcription not configured (OPENAI_API_KEY missing)" })
      .where(eq(mediaTable.id, mediaId));
    return;
  }

  try {
    const [media] = await db.select().from(mediaTable).where(eq(mediaTable.id, mediaId));
    if (!media) return;

    await db
      .update(mediaTable)
      .set({ transcriptionStatus: "processing", transcriptionError: null })
      .where(eq(mediaTable.id, mediaId));

    const buffer = audio?.buffer ?? (await downloadObjectBuffer(media.url));
    const filename = audio?.filename ?? media.filename;
    const mimeType = audio?.mimeType ?? media.mimeType ?? "audio/webm";

    const transcript = await transcribeAudio(buffer, filename, mimeType);
    const visitMeta = await getVisitMeta(media.visitId);
    const { structured, transcriptionError } = await buildStructuredTranscript(
      transcript,
      visitMeta?.repId,
    );

    await writeTranscriptResult({
      mediaId,
      visitId: media.visitId,
      transcript,
      structured,
      transcriptionError,
      source: "audio",
    });

    logger.info({ mediaId }, "Transcription complete");
  } catch (err) {
    const message = getErrorMessage(err);
    logger.error({ err, mediaId }, "Transcription failed");
    await db
      .update(mediaTable)
      .set({ transcriptionStatus: "error", transcriptionError: message.slice(0, 500) })
      .where(eq(mediaTable.id, mediaId))
      .catch(() => undefined);
  }
}

export async function processTextTranscriptMedia(
  mediaId: number,
  transcriptText?: string,
): Promise<void> {
  try {
    const [media] = await db.select().from(mediaTable).where(eq(mediaTable.id, mediaId));
    if (!media) return;

    await db
      .update(mediaTable)
      .set({ transcriptionStatus: "processing", transcriptionError: null })
      .where(eq(mediaTable.id, mediaId));

    if (!isPlainTextTranscriptFile({ filename: media.filename, mimeType: media.mimeType })) {
      await db
        .update(mediaTable)
        .set({ transcriptionStatus: "error", transcriptionError: "This media item is not a plain-text transcript" })
        .where(eq(mediaTable.id, mediaId));
      return;
    }

    const transcript = transcriptText ?? bufferToTranscriptText(await downloadObjectBuffer(media.url));
    const visitMeta = await getVisitMeta(media.visitId);
    const { structured, transcriptionError } = await buildStructuredTranscript(
      transcript,
      visitMeta?.repId,
    );

    await writeTranscriptResult({
      mediaId,
      visitId: media.visitId,
      transcript,
      structured,
      transcriptionError,
      source: "text",
    });

    logger.info({ mediaId }, "Text transcript ingestion complete");
  } catch (err) {
    const message = getErrorMessage(err);
    logger.error({ err, mediaId }, "Text transcript ingestion failed");
    await db
      .update(mediaTable)
      .set({ transcriptionStatus: "error", transcriptionError: message.slice(0, 500) })
      .where(eq(mediaTable.id, mediaId))
      .catch(() => undefined);
  }
}

export function shouldTreatAsTranscriptDocument(opts: { filename?: string | null; mimeType?: string | null; type?: string | null }): boolean {
  return opts.type === "document" && isPlainTextTranscriptFile(opts);
}
