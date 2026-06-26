import { and, asc, eq } from "drizzle-orm";
import {
  db,
  coachingProfilesTable,
  coachingKnowledgeDocsTable,
  type CoachingProfile,
  type CoachingKnowledgeDoc,
} from "@workspace/db";

/**
 * Coaching knowledge base resolver + compiler.
 *
 * Resolution order (deterministic):
 *   1. rep scope: coaching_profiles where scopeType='rep', scopeKey=repId, enabled=true
 *   2. global fallback: scopeType='global', scopeKey='default', enabled=true
 *   3. null if neither exists
 *
 * The compiler turns the resolved profile + enabled docs into a normalized
 * coaching context payload consumed by Hermes. Compiled strings are meant for
 * slice-2 prompt assembly; slice 1 only wires the plumbing.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ResolvedCoachingContext {
  profile: null | {
    id: number;
    name: string;
    scopeType: "global" | "rep" | "team";
    scopeKey: string;
  };
  instructions: {
    transcript: string | null;
    coaching: string | null;
  };
  knowledgeDocs: Array<{
    id: number;
    title: string;
    sourceType: string;
    methodTag: string | null;
    sortOrder: number;
    body: string;
  }>;
  methodTags: string[];
  compiled: {
    transcript: string;
    coaching: string;
  };
}

// ---------------------------------------------------------------------------
// Fixed preambles
// ---------------------------------------------------------------------------

const COACHING_PREAMBLE = [
  "Facts from the transcript and structured output are the source of truth.",
  "Coaching knowledge may shape framing, prioritization, objection handling, and next-step recommendations.",
  "Coaching knowledge must never invent facts that were not present in the transcript or visit context.",
].join("\n");

const TRANSCRIPT_PREAMBLE = [
  "Extract facts first.",
  "Use profile instructions only to sharpen labels like buyer stage, objection category, or next-step quality.",
  "Do not rewrite, embellish, or add unsupported facts.",
].join("\n");

// ---------------------------------------------------------------------------
// Empty result
// ---------------------------------------------------------------------------

export const EMPTY_COACHING_CONTEXT: ResolvedCoachingContext = {
  profile: null,
  instructions: { transcript: null, coaching: null },
  knowledgeDocs: [],
  methodTags: [],
  compiled: { transcript: "", coaching: "" },
};

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

async function resolveProfile(repId?: string | null): Promise<CoachingProfile | null> {
  // 1. rep scope
  if (repId) {
    const [repProfile] = await db
      .select()
      .from(coachingProfilesTable)
      .where(
        and(
          eq(coachingProfilesTable.scopeType, "rep"),
          eq(coachingProfilesTable.scopeKey, repId),
          eq(coachingProfilesTable.enabled, true),
        ),
      )
      .limit(1);
    if (repProfile) return repProfile;
  }

  // 2. global fallback
  const [globalProfile] = await db
    .select()
    .from(coachingProfilesTable)
    .where(
      and(
        eq(coachingProfilesTable.scopeType, "global"),
        eq(coachingProfilesTable.scopeKey, "default"),
        eq(coachingProfilesTable.enabled, true),
      ),
    )
    .limit(1);
  return globalProfile ?? null;
}

// ---------------------------------------------------------------------------
// Compiler
// ---------------------------------------------------------------------------

function renderDocSection(doc: CoachingKnowledgeDoc): string {
  const header = `[${doc.title}]`
  const tag = doc.methodTag ? ` (method: ${doc.methodTag})` : ""
  return `${header}${tag}\n${doc.body}`
}

function buildMethodTags(docs: CoachingKnowledgeDoc[]): string[] {
  const seen = new Set<string>()
  const tags: string[] = []
  for (const doc of docs) {
    if (doc.methodTag && !seen.has(doc.methodTag)) {
      seen.add(doc.methodTag)
      tags.push(doc.methodTag)
    }
  }
  return tags
}

function compileCoaching(
  profile: CoachingProfile,
  docs: CoachingKnowledgeDoc[],
): string {
  const parts: string[] = [COACHING_PREAMBLE]

  if (profile.coachingInstructions) {
    parts.push(profile.coachingInstructions)
  }

  for (const doc of docs) {
    parts.push(renderDocSection(doc))
  }

  return parts.join("\n\n")
}

function compileTranscript(profile: CoachingProfile): string {
  const parts: string[] = [TRANSCRIPT_PREAMBLE]

  if (profile.transcriptInstructions) {
    parts.push(profile.transcriptInstructions)
  }

  return parts.join("\n\n")
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function resolveCoachingContext(
  repId?: string | null,
): Promise<ResolvedCoachingContext> {
  const profile = await resolveProfile(repId)
  if (!profile) return EMPTY_COACHING_CONTEXT

  const docs = await db
    .select()
    .from(coachingKnowledgeDocsTable)
    .where(
      and(
        eq(coachingKnowledgeDocsTable.profileId, profile.id),
        eq(coachingKnowledgeDocsTable.enabled, true),
      ),
    )
    .orderBy(asc(coachingKnowledgeDocsTable.sortOrder), asc(coachingKnowledgeDocsTable.id))

  const methodTags = buildMethodTags(docs)

  return {
    profile: {
      id: profile.id,
      name: profile.name,
      scopeType: profile.scopeType as "global" | "rep" | "team",
      scopeKey: profile.scopeKey,
    },
    instructions: {
      transcript: profile.transcriptInstructions,
      coaching: profile.coachingInstructions,
    },
    knowledgeDocs: docs.map((d) => ({
      id: d.id,
      title: d.title,
      sourceType: d.sourceType,
      methodTag: d.methodTag,
      sortOrder: d.sortOrder,
      body: d.body,
    })),
    methodTags,
    compiled: {
      transcript: compileTranscript(profile),
      coaching: compileCoaching(profile, docs),
    },
  }
}
