import { eq } from "drizzle-orm";
import { db, mediaTable } from "@workspace/db";
import { ObjectStorageService } from "./objectStorage";
import { logger } from "./logger";
import { logEvent } from "./events";

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
}

function getApiKey(): string | null {
  return process.env.OPENAI_API_KEY ?? null;
}

export function isTranscriptionConfigured(): boolean {
  return getApiKey() !== null;
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

const STRUCTURING_PROMPT = `You analyze transcripts of voice notes that a door-to-door sales rep records right after a business visit. Extract structured data. Respond with JSON only, matching this shape:
{
  "summary": "1-2 sentence summary of the visit",
  "interestLevel": "hot" | "warm" | "cool" | "cold" | "unknown",
  "objections": ["each objection the prospect raised"],
  "followUpItems": ["each concrete follow-up action mentioned"],
  "contactInfo": "any names/phones/emails mentioned, or omit",
  "nextStep": "the single most important next action, or omit"
}`;

async function structureTranscript(transcript: string): Promise<StructuredNote | null> {
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

  const parsed = JSON.parse(content) as Partial<StructuredNote>;
  return {
    summary: parsed.summary ?? "",
    interestLevel: parsed.interestLevel ?? "unknown",
    objections: Array.isArray(parsed.objections) ? parsed.objections : [],
    followUpItems: Array.isArray(parsed.followUpItems) ? parsed.followUpItems : [],
    ...(parsed.contactInfo ? { contactInfo: parsed.contactInfo } : {}),
    ...(parsed.nextStep ? { nextStep: parsed.nextStep } : {}),
  };
}

async function loadAudioFromStorage(url: string): Promise<Buffer> {
  // Stored serving URLs look like /api/storage/objects/<id>
  const objectPath = url.replace(/^\/api\/storage/, "");
  const storage = new ObjectStorageService();
  const file = await storage.getObjectEntityFile(objectPath);
  const [buffer] = await file.download();
  return buffer;
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

    const buffer = audio?.buffer ?? (await loadAudioFromStorage(media.url));
    const filename = audio?.filename ?? media.filename;
    const mimeType = audio?.mimeType ?? media.mimeType ?? "audio/webm";

    const transcript = await transcribeAudio(buffer, filename, mimeType);
    const structured = await structureTranscript(transcript);

    await db
      .update(mediaTable)
      .set({
        transcript,
        aiStructured: structured,
        transcriptionStatus: "done",
        transcriptionError: null,
      })
      .where(eq(mediaTable.id, mediaId));

    await logEvent({
      type: "media.transcribed",
      entityType: "media",
      entityId: mediaId,
      visitId: media.visitId,
      payload: {
        interestLevel: structured?.interestLevel,
        objectionCount: structured?.objections.length ?? 0,
        followUpCount: structured?.followUpItems.length ?? 0,
        transcriptChars: transcript.length,
      },
    });

    logger.info({ mediaId }, "Transcription complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ err, mediaId }, "Transcription failed");
    await db
      .update(mediaTable)
      .set({ transcriptionStatus: "error", transcriptionError: message.slice(0, 500) })
      .where(eq(mediaTable.id, mediaId))
      .catch(() => undefined);
  }
}
