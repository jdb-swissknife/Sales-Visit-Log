import { readFileSync } from "node:fs";
import { HermesClient } from "./client";
import { buildDebrief, DEFAULT_DEBRIEF_CONFIG } from "./debrief";
import { generateCoachingSuggestion } from "./llm";
import type { ResolvedCoachingContext } from "./types";

type Envelope = {
  version: string;
  eventId: string;
  eventType:
    | "visit.created"
    | "visit.updated"
    | "media.transcribed"
    | "callback.due"
    | "day.ended"
    | "visit.synced_offline";
  occurredAt: string;
  source: string;
  environment: string;
  correlationId?: string | null;
  rep?: { id?: string | null; name?: string | null } | null;
  business?: { id?: number | null; name?: string | null; address?: string | null } | null;
  visit?: { id?: number | null; outcome?: string | null; visitedAt?: string | null } | null;
  callback?: { visitId?: number | null; dueAt?: string | null } | null;
  media?: { id?: number | null; type?: string | null; transcript?: string | null } | null;
  daySummary?: Record<string, unknown> | null;
  appContext?: Record<string, unknown> | null;
  links?: Record<string, string> | null;
};

type ProcessorResult = {
  posted: number;
  skipped?: string;
  suggestionType?: string;
  dedupeKey?: string;
};

function requireArg(): string {
  const file = process.argv[2];
  if (!file) throw new Error("usage: run-webhook <payload.json>");
  return file;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function parseEnvelope(file: string): Envelope {
  return JSON.parse(readFileSync(file, "utf8")) as Envelope;
}

function payloadOf(envelope: Envelope): Record<string, unknown> {
  const payload = envelope.appContext?.payload;
  return payload && typeof payload === "object" ? (payload as Record<string, unknown>) : {};
}

function repIdOf(envelope: Envelope): string | undefined {
  return envelope.rep?.id ?? undefined;
}

function businessIdOf(envelope: Envelope): number | undefined {
  return envelope.business?.id ?? undefined;
}

function businessNameOf(envelope: Envelope): string {
  return envelope.business?.name ?? (businessIdOf(envelope) ? `Prospect #${businessIdOf(envelope)}` : "this prospect");
}

function visitIdOf(envelope: Envelope): number | undefined {
  return envelope.visit?.id ?? envelope.callback?.visitId ?? undefined;
}

function actionUrlOf(envelope: Envelope): string | undefined {
  const visitId = visitIdOf(envelope);
  if (visitId) return `/visits/${visitId}`;
  const businessId = businessIdOf(envelope);
  if (businessId) return `/businesses/${businessId}`;
  return undefined;
}

function isoHoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

function hasUsableCallback(dueAt: string | null | undefined): boolean {
  return Boolean(dueAt && !dueAt.startsWith("1970-01-01T00:00:00"));
}

async function postVisitCoaching(client: HermesClient, agentRunId: number, envelope: Envelope): Promise<ProcessorResult> {
  const repId = repIdOf(envelope);
  const businessId = businessIdOf(envelope);
  const visitId = visitIdOf(envelope);
  const outcome = String(envelope.visit?.outcome ?? payloadOf(envelope).outcome ?? "");
  const dueAt = envelope.callback?.dueAt ?? null;
  const hasCallback = hasUsableCallback(dueAt);

  if (!repId) return { posted: 0, skipped: "missing_rep_id" };
  if (!businessId || !visitId) return { posted: 0, skipped: "missing_business_or_visit" };
  if (!["positive", "follow_up_needed"].includes(outcome)) {
    return { posted: 0, skipped: "outcome_not_actionable" };
  }
  if (hasCallback) {
    return { posted: 0, skipped: "callback_already_set" };
  }

  const businessName = businessNameOf(envelope);
  const dedupeKey = `visit-next-step:${visitId}`;
  await client.postSuggestion({
    agentRunId,
    type: "coaching",
    title: `Lock in the next step for ${businessName}`,
    body:
      `You logged ${businessName} with a ${outcome.replace(/_/g, " ")} outcome, but there is no callback date on the visit yet. ` +
      `While the conversation is still fresh, set an exact follow-up date or the lead can cool off fast.`,
    businessId,
    repId,
    priority: "high",
    priorityScore: 0.82,
    dedupeKey,
    actionLabel: "Open visit",
    actionUrl: actionUrlOf(envelope),
    expiresAt: isoHoursFromNow(48),
    data: {
      eventId: envelope.eventId,
      visitId,
      outcome,
      callbackMissing: true,
      sourceEventType: envelope.eventType,
    },
  });

  return { posted: 1, suggestionType: "coaching", dedupeKey };
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Merge coaching context metadata into a suggestion's data payload. Pure
 * function for testability. When a profile is present, attaches profile
 * metadata + method tags + doc references and sets coachingContextApplied.
 * When no profile is resolved, only sets coachingContextApplied=false.
 */
export function mergeCoachingMetadata(
  data: Record<string, unknown>,
  ctx: ResolvedCoachingContext | null,
): Record<string, unknown> {
  if (!ctx || !ctx.profile) {
    return { ...data, coachingContextApplied: false };
  }
  return {
    ...data,
    coachingContextApplied: true,
    coachingProfileId: ctx.profile.id,
    coachingProfileName: ctx.profile.name,
    coachingProfileScopeType: ctx.profile.scopeType,
    coachingProfileScopeKey: ctx.profile.scopeKey,
    coachingMethodTags: ctx.methodTags,
    coachingKnowledgeDocIds: ctx.knowledgeDocs.map((d) => d.id),
    coachingKnowledgeDocTitles: ctx.knowledgeDocs.map((d) => d.title),
  };
}

/**
 * Fetch coaching context for a rep. Never throws: on failure, returns null
 * so the caller can continue with deterministic coaching behavior.
 */
async function safeGetCoachingContext(
  client: HermesClient,
  repId: string,
): Promise<ResolvedCoachingContext | null> {
  try {
    return await client.getCoachingContext({ repId });
  } catch (err) {
    console.warn(`coaching context lookup failed for rep ${repId}: ${err instanceof Error ? err.message : err}`);
    return null;
  }
}

async function postMediaCoaching(client: HermesClient, agentRunId: number, envelope: Envelope): Promise<ProcessorResult> {
  const repId = repIdOf(envelope);
  const businessId = businessIdOf(envelope);
  const visitId = visitIdOf(envelope);
  const payload = payloadOf(envelope);
  const interestLevel = typeof payload.interestLevel === "string" ? payload.interestLevel : "unknown";
  const summary = typeof payload.summary === "string" ? payload.summary : "";
  const nextStep = typeof payload.nextStep === "string" ? payload.nextStep : "";
  const contactInfo = typeof payload.contactInfo === "string" ? payload.contactInfo : "";
  const objections = asStringArray(payload.objections);
  const followUpItems = asStringArray(payload.followUpItems);
  const callbackMissing = !hasUsableCallback(envelope.callback?.dueAt ?? null);

  if (!repId) return { posted: 0, skipped: "missing_rep_id" };
  if (!businessId || !visitId) return { posted: 0, skipped: "missing_business_or_visit" };
  if (!["hot", "warm"].includes(interestLevel) && followUpItems.length === 0 && objections.length === 0 && !nextStep && !contactInfo) {
    return { posted: 0, skipped: "transcription_not_actionable" };
  }

  const businessName = businessNameOf(envelope);
  const mediaId = envelope.media?.id ?? envelope.eventId;
  const dedupeKey = `voice-coaching:${mediaId}`;

  // Fetch coaching context (never blocks the suggestion on failure).
  const coachingCtx = await safeGetCoachingContext(client, repId);

  // Try LLM-generated coaching when a profile is resolved. Falls back to
  // hardcoded templates if the LLM is unavailable, not configured, or fails.
  let coachingGenerated = false;
  let title!: string;
  let body!: string;

  if (coachingCtx?.profile) {
    const llmResult = await generateCoachingSuggestion(
      {
        businessName,
        interestLevel,
        summary,
        nextStep,
        followUpItems,
        objections,
        contactInfo,
        callbackMissing,
      },
      coachingCtx.compiled.coaching,
    );
    if (llmResult) {
      coachingGenerated = true;
      title = llmResult.title;
      body = llmResult.body;
    }
  }

  if (!coachingGenerated) {
    title =
      interestLevel === "hot"
        ? `${businessName} sounds hot. Lock the next step now`
        : nextStep
          ? `Your ${businessName} voice note already named the next move`
          : objections.length > 0
            ? `Handle ${businessName}'s objections while the visit is fresh`
            : `Turn your ${businessName} voice note into a concrete next step`;

    const lines = [
      `The transcription came back ${interestLevel}.`,
      summary ? `Summary: ${summary}` : "",
      nextStep ? `Next step mentioned: ${nextStep}` : "",
      followUpItems.length > 0 ? `Follow-ups captured: ${followUpItems.join("; ")}` : "",
      objections.length > 0 ? `Objections to handle: ${objections.join("; ")}` : "",
      contactInfo ? `Contact detail captured: ${contactInfo}` : "",
      callbackMissing
        ? "You still do not have a callback date on the visit. Put one on the calendar before this sits in notes only."
        : "Now convert the note into a concrete action while the visit is still fresh.",
      coachingCtx?.profile ? `Coaching profile: ${coachingCtx.profile.name}` : "",
    ].filter(Boolean);

    body = lines.join("\n\n");
  }

  const baseData: Record<string, unknown> = {
    eventId: envelope.eventId,
    visitId,
    mediaId: envelope.media?.id ?? null,
    interestLevel,
    summary: summary || null,
    nextStep: nextStep || null,
    followUpItems,
    followUpCount: followUpItems.length,
    objections,
    objectionCount: objections.length,
    contactInfo: contactInfo || null,
    callbackMissing,
    sourceEventType: envelope.eventType,
    coachingGenerated,
  };

  await client.postSuggestion({
    agentRunId,
    type: "coaching",
    title,
    body,
    businessId,
    repId,
    priority: ["hot", "warm"].includes(interestLevel) ? "high" : "normal",
    priorityScore: ["hot", "warm"].includes(interestLevel) ? 0.86 : 0.64,
    dedupeKey,
    actionLabel: "Review visit",
    actionUrl: actionUrlOf(envelope),
    expiresAt: isoHoursFromNow(48),
    data: mergeCoachingMetadata(baseData, coachingCtx),
  });

  return { posted: 1, suggestionType: "coaching", dedupeKey };
}

async function postDayDebrief(client: HermesClient, agentRunId: number, envelope: Envelope): Promise<ProcessorResult> {
  const repId = repIdOf(envelope);
  if (!repId) return { posted: 0, skipped: "missing_rep_id" };
  const occurredAt = new Date(envelope.occurredAt);
  const card = buildDebrief({
    repId,
    daySummary: envelope.daySummary ?? {},
    occurredAt: Number.isNaN(occurredAt.getTime()) ? new Date() : occurredAt,
    now: new Date(),
    cfg: DEFAULT_DEBRIEF_CONFIG,
    agentRunId,
  });

  if (!card) return { posted: 0, skipped: "empty_day_summary" };

  await client.postSuggestion({
    ...card,
    actionLabel: "Open coaching feed",
    actionUrl: "/",
    data: {
      ...card.data,
      eventId: envelope.eventId,
      sourceEventType: envelope.eventType,
    },
  });

  return { posted: 1, suggestionType: "debrief", dedupeKey: card.dedupeKey };
}

async function processEnvelope(client: HermesClient, agentRunId: number, envelope: Envelope): Promise<ProcessorResult> {
  switch (envelope.eventType) {
    case "visit.created":
    case "visit.updated":
      return postVisitCoaching(client, agentRunId, envelope);
    case "media.transcribed":
      return postMediaCoaching(client, agentRunId, envelope);
    case "day.ended":
      return postDayDebrief(client, agentRunId, envelope);
    case "callback.due":
      return { posted: 0, skipped: "handled_in_app_by_callback_cron" };
    case "visit.synced_offline":
      return { posted: 0, skipped: "offline_sync_ingest_only" };
    default:
      return { posted: 0, skipped: "unsupported_event_type" };
  }
}

async function main(): Promise<void> {
  const file = requireArg();
  const envelope = parseEnvelope(file);
  const client = new HermesClient({
    baseUrl: process.env.HERMES_BASE_URL ?? process.env.BASE_URL ?? "http://localhost:8090",
    apiKey: requireEnv("AGENT_API_KEY"),
  });

  const run = await client.createRun({
    eventType: envelope.eventType,
    eventId: envelope.eventId,
    correlationId: envelope.correlationId ?? undefined,
    status: "running",
  });

  try {
    const result = await processEnvelope(client, run.id, envelope);
    await client.patchRun(run.id, {
      status: result.posted > 0 ? "completed" : "skipped",
      output: { eventId: envelope.eventId, ...result },
    });
    console.log(JSON.stringify({ agentRunId: run.id, eventType: envelope.eventType, ...result }, null, 2));
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await client.patchRun(run.id, { status: "failed", error: message });
    throw err;
  }
}

// Only run main() when this file is the entry point, not when imported
// (e.g. by tests importing mergeCoachingMetadata).
const isMainModule =
  process.argv[1]?.endsWith("run-webhook.ts") ||
  process.argv[1]?.endsWith("run-webhook");

if (isMainModule) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
