# Coaching Knowledge Base Slice 1 Implementation Plan

> For Hermes: use subagent-driven-development if executing this plan task-by-task.

Goal: add real storage and runtime resolution for team-specific coaching knowledge so Sales Visit Log can look up the active coaching profile for a rep and hand that context to Hermes in a deterministic, testable way.

Architecture: api-server owns coaching profile data, resolution, and compilation. Hermes remains a thin HTTP client. Slice 1 does not promise true Erica-voice free-form coaching yet because the current webhook coaching path is still hardcoded TypeScript, not an LLM prompt pipeline. Slice 1 builds the plumbing needed so slice 2 can swap hardcoded coaching copy for profile-aware generation without redesigning storage.

Tech stack: Postgres, Drizzle ORM, Express agent routes, TypeScript, HermesClient, TSX tests.

---

## 1. Current repo reality

These are the real current hardcoded surfaces.

Transcript structuring:
- `artifacts/api-server/src/lib/transcription.ts`
- `artifacts/plaud-sync/src/sync.ts`

Webhook coaching suggestion copy:
- `artifacts/hermes-agent/src/run-webhook.ts`

Current scope primitive:
- `visits.rep_id` is still free-form text in `lib/db/src/schema/visits.ts`
- `events.rep_id` is still free-form text in `lib/db/src/schema/events.ts`
- `agent_suggestions.rep_id` is still free-form text in `lib/db/src/schema/agent-suggestions.ts`

Important constraint:
- there is no real company/team auth model wired through this repo yet
- the safest first scope key is still `repId`

## 2. Product outcome for slice 1

After slice 1 lands, the system must be able to:

1. store a coaching profile for a scope
2. store multiple enabled/disabled knowledge docs under that profile
3. resolve the active profile for a rep deterministically
4. compile that profile + docs into a normalized coaching context payload
5. expose that payload to Hermes over the existing agent-auth API
6. attach resolved profile metadata to coaching suggestions without breaking current behavior

What slice 1 does not do:
- no admin UI
- no public app UI for editing profiles/docs
- no retrieval/chunking/vector search
- no full Erica-style generative coaching output yet
- no team/company mapping logic beyond future-safe schema fields
- no transcript prompt rewrite yet

## 3. Why this slice first

Right now, "coaching like Erica" cannot be real because there is nowhere to store Erica's coaching method as system data.

Before changing prompting, we need a source of truth that answers:
- which profile applies to this rep
- which docs are enabled
- what instructions and method tags belong to this profile

This slice builds that foundation first.

## 4. Exact schema to add

### 4.1 `coaching_profiles`

Create: `lib/db/src/schema/coaching-profiles.ts`

Fields:
- `id` serial primary key
- `scopeType` text not null default `global`
  - allowed values in slice 1: `global | rep | team`
  - only `global` and `rep` are actually used in resolution now
- `scopeKey` text not null
  - examples:
    - `default` for the fallback global profile
    - `rep-7` for a rep-specific profile
- `name` text not null
- `transcriptInstructions` text nullable
- `coachingInstructions` text nullable
- `enabled` boolean not null default `true`
- `createdAt` timestamp with timezone not null default now
- `updatedAt` timestamp with timezone not null default now and `$onUpdate(() => new Date())`

Indexes / constraints:
- unique index on `(scopeType, scopeKey)`
- index on `(enabled, scopeType, scopeKey)`

Why this shape:
- one row per scope keeps resolution simple
- future team scoping is possible without redesign
- transcript and coaching instructions stay separated

### 4.2 `coaching_knowledge_docs`

Create: `lib/db/src/schema/coaching-knowledge-docs.ts`

Fields:
- `id` serial primary key
- `profileId` integer not null references `coaching_profiles.id` on delete cascade
- `title` text not null
- `sourceType` text not null
  - examples: `leader_playbook`, `objection_library`, `buyer_type`, `offer_context`, `external_framework`, `compliance_rule`
- `methodTag` text nullable
  - examples: `erica`, `straight_line`, `hvac_atlanta`
- `body` text not null
- `sortOrder` integer not null default `100`
- `enabled` boolean not null default `true`
- `createdAt` timestamp with timezone not null default now
- `updatedAt` timestamp with timezone not null default now and `$onUpdate(() => new Date())`

Indexes:
- index on `(profileId, enabled, sortOrder)`

Why this shape:
- `sortOrder` gives deterministic prompt order without adding retrieval complexity
- `methodTag` lets later suggestions expose which method influenced the advice
- we avoid tags arrays and vector infrastructure for now

### 4.3 exports

Modify:
- `lib/db/src/schema/index.ts`

Add exports for both new schema files.

No change needed to `lib/db/src/index.ts` beyond the existing `export * from "./schema";` behavior.

## 5. Resolution rules

Create: `artifacts/api-server/src/lib/coaching-context.ts`

Add a pure resolver that takes:
- `repId?: string | null`

Resolution order:
1. if `repId` is provided, look for enabled `coaching_profiles` row with:
   - `scopeType = 'rep'`
   - `scopeKey = repId`
2. else look for enabled global fallback row with:
   - `scopeType = 'global'`
   - `scopeKey = 'default'`
3. if neither exists, return `null`

Important rule:
- do not invent team resolution yet
- keep the resolver deterministic and tiny
- do not reach into visits/businesses/auth tables for team lookup in slice 1

## 6. Compiled context contract

The same `coaching-context.ts` file should also export a compiler.

Compiler output shape:

```ts
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
```

Compilation rules:
- only include enabled docs
- sort docs by `sortOrder asc, id asc`
- `methodTags` is the unique set of non-null `methodTag` values in sorted order
- `compiled.coaching` must concatenate:
  1. a fixed grounding preamble
  2. `coachingInstructions` if present
  3. each enabled doc rendered in deterministic section format
- `compiled.transcript` must be light-touch only:
  1. a fixed factual-extraction preamble
  2. `transcriptInstructions` if present
- do not stuff full docs into `compiled.transcript` in slice 1

Required fixed preamble for coaching compilation:
- facts from the transcript and structured output are the source of truth
- coaching knowledge may shape framing, prioritization, objection handling, and next-step recommendations
- coaching knowledge must never invent facts that were not present in the transcript or visit context

Required fixed preamble for transcript compilation:
- extract facts first
- use profile instructions only to sharpen labels like buyer stage, objection category, or next-step quality
- do not rewrite, embellish, or add unsupported facts

## 7. Agent API surface to add

Modify: `artifacts/api-server/src/routes/agent.ts`

Add a new read-only route behind existing agent auth:
- `GET /api/agent/coaching-context?repId=<repId>`

Behavior:
- if `repId` is provided, resolve rep profile then global fallback
- if `repId` is omitted, resolve global fallback only
- return `200` with the compiled context object
- if nothing matches, return the same object shape with:
  - `profile: null`
  - empty `knowledgeDocs`
  - empty `methodTags`
  - `compiled.transcript = ""`
  - `compiled.coaching = ""`

Why read-only first:
- slice 1 is plumbing, not profile management UI
- first Erica profile can be inserted by direct DB seed/manual insert
- CRUD routes can be slice 2 or slice 3

## 8. Hermes client changes

Modify: `artifacts/hermes-agent/src/types.ts`

Add a local type for the coaching-context response.

Modify: `artifacts/hermes-agent/src/client.ts`

Add:

```ts
getCoachingContext(params: { repId?: string }): Promise<ResolvedCoachingContext>
```

Query behavior:
- omit the query string when `repId` is missing
- encode `repId` as `?repId=...` when present

## 9. Webhook coaching integration for slice 1

Modify: `artifacts/hermes-agent/src/run-webhook.ts`

Important truth:
- current media coaching in this file is hardcoded template logic
- that means slice 1 should not pretend it can suddenly generate rich Erica-style copy from knowledge docs alone

So the integration for slice 1 is:

1. call `client.getCoachingContext({ repId })` inside `postMediaCoaching`
2. if context exists, keep the current title/body logic mostly intact
3. enrich the suggestion `data` payload with:
   - `coachingProfileId`
   - `coachingProfileName`
   - `coachingProfileScopeType`
   - `coachingProfileScopeKey`
   - `coachingMethodTags`
   - `coachingKnowledgeDocIds`
   - `coachingKnowledgeDocTitles`
   - `coachingContextApplied: true`
4. if no context exists, set `coachingContextApplied: false`
5. do not change visit coaching or day debrief in slice 1

Optional low-risk text change allowed in slice 1:
- append a short final line like `Coaching profile: Erica HVAC Playbook` only when a profile exists

Do not do this yet in slice 1:
- no external LLM call from `run-webhook.ts`
- no free-form prompt assembly in Hermes runtime
- no new failure path that blocks suggestion posting when coaching context lookup fails

Failure rule:
- if `GET /api/agent/coaching-context` fails, log and continue with today's current deterministic coaching behavior

## 10. Files to create and modify

### Create
- `lib/db/src/schema/coaching-profiles.ts`
- `lib/db/src/schema/coaching-knowledge-docs.ts`
- `artifacts/api-server/src/lib/coaching-context.ts`
- `artifacts/api-server/tests/agent-coaching-context.test.ts`
- `artifacts/hermes-agent/tests/coaching-context.test.ts`

### Modify
- `lib/db/src/schema/index.ts`
- `artifacts/api-server/src/routes/agent.ts`
- `artifacts/hermes-agent/src/types.ts`
- `artifacts/hermes-agent/src/client.ts`
- `artifacts/hermes-agent/src/run-webhook.ts`

### Explicitly not in slice 1
- `artifacts/api-server/src/lib/transcription.ts`
- `artifacts/plaud-sync/src/sync.ts`
- app UI files
- public API client generation

## 11. Test plan

### 11.1 API-server tests

Create: `artifacts/api-server/tests/agent-coaching-context.test.ts`

Cover these cases:
1. rep profile beats global profile
2. global profile is returned when rep profile is missing
3. disabled profile does not resolve
4. disabled docs are excluded
5. docs are sorted by `sortOrder asc, id asc`
6. method tags are unique and ordered
7. empty result returns the normalized empty shape

Use the same DB-gated test style already used in:
- `artifacts/api-server/tests/agent-events-repid.test.ts`
- `artifacts/api-server/tests/callback-cron.test.ts`

### 11.2 Hermes agent tests

Create: `artifacts/hermes-agent/tests/coaching-context.test.ts`

Cover these cases:
1. `HermesClient.getCoachingContext({ repId })` hits `/api/agent/coaching-context?repId=...`
2. `HermesClient.getCoachingContext({})` hits `/api/agent/coaching-context`
3. `postMediaCoaching` includes coaching metadata in suggestion `data` when context is present
4. `postMediaCoaching` still posts the current style of suggestion when context lookup fails

Implementation note:
- if `postMediaCoaching` is hard to test directly, extract a small pure helper for merging context metadata into suggestion payload data and test that helper

## 12. Manual verification flow

From repo root: `/root/projects/sales-visit-log`

### Step 1: push schema
Run:
- `pnpm --filter @workspace/db push`

Expected:
- drizzle push completes without error

### Step 2: run typechecks
Run:
- `pnpm --filter @workspace/api-server typecheck`
- `pnpm --filter @workspace/hermes-agent typecheck`

Expected:
- both pass

### Step 3: run focused tests
Run:
- `pnpm --filter @workspace/api-server test`
- `pnpm --filter @workspace/hermes-agent test`

Expected:
- new coaching-context tests pass
- existing tests still pass

### Step 4: seed one real profile
Seed at least:
- one global profile with `scopeType=global`, `scopeKey=default`
- one rep profile for Erica pilot rep scope if desired
- two enabled docs under the profile
  - Erica playbook doc
  - objection library or Straight Line summary doc

### Step 5: verify agent route by curl
Run with agent key:
- `curl -H "Authorization: Bearer $AGENT_API_KEY" "http://127.0.0.1:8090/api/agent/coaching-context?repId=<repId>"`

Expected:
- profile metadata appears
- docs are ordered
- compiled strings are non-empty

### Step 6: replay one media.transcribed event
Expected:
- suggestion still posts successfully
- suggestion `data` contains coaching profile metadata
- if context is unavailable, existing behavior remains intact

## 13. Acceptance criteria

Slice 1 is done only when all of these are true:

1. the database has real `coaching_profiles` and `coaching_knowledge_docs` tables
2. rep/global resolution works deterministically
3. API returns a normalized compiled context shape
4. Hermes client can fetch that context
5. media coaching suggestions carry profile metadata when available
6. no existing coaching/test path regresses
7. no false claim is made that the system already fully coaches in Erica's voice

## 14. Follow-on slice after this one

Slice 2 should do the real coaching generation upgrade:
- replace hardcoded `postMediaCoaching` copy with prompt-driven output using `compiled.coaching`
- optionally reuse `compiled.transcript` in transcript structuring
- add a minimal admin surface for browsing/editing profiles and docs

That is the slice where "AI that coaches like Erica" becomes materially true.
