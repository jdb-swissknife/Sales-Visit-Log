# Team-Specific Coaching Knowledge Base Plan

> For Hermes: implement in small slices. Do not block on full team auth.

Goal
- Let each sales team choose the coaching knowledge used for transcript structuring and coaching suggestions.
- Example: a team can combine its sales leader's internal playbook with an external framework like Jordan Belfort's Straight Line method.

Current repo reality
- Transcript structuring is hardcoded today in:
  - artifacts/api-server/src/lib/transcription.ts
  - artifacts/plaud-sync/src/sync.ts
- Coaching suggestion copy is hardcoded today in:
  - artifacts/hermes-agent/src/run-webhook.ts
- Real team auth has not landed yet. Current agent/event/suggestion scoping is still free-form repId text.

Architecture
1. Keep extraction separate from coaching.
   - Pass A: factual transcript structuring
   - Pass B: coaching generation using structured facts + team knowledge
2. Do not hardcode one sales philosophy into app logic.
   - Store team-selected knowledge packs in data
   - Compile a prompt from enabled packs at runtime
3. Do not wait for full team/company auth.
   - Introduce a scope key now that can be rep-scoped or future team-scoped
   - Later map that scope key to real company/team records

Proposed data model
1. coaching_profiles
   - id
   - scope_type: global | rep | team
   - scope_key: text
   - name
   - transcript_instructions
   - coaching_instructions
   - enabled
   - created_at / updated_at

2. coaching_knowledge_docs
   - id
   - profile_id
   - title
   - source_type: internal_playbook | external_framework | product_offer | objection_library | compliance_rule
   - body
   - weight
   - enabled
   - created_at / updated_at

3. Optional later: coaching_knowledge_snippets
   - extracted principles/snippets for retrieval
   - only add if full document stuffing gets too noisy

Prompt strategy
A. Transcript structuring prompt
- Input: raw transcript + business/visit context
- Team knowledge use: light touch only
- Purpose: extract factual fields, not persuasion style
- Add fields later if useful:
  - buyingStage
  - painPoints
  - urgencySignals
  - decisionMaker
  - competitorMentioned
  - riskFlags

B. Coaching generation prompt
- Input:
  - structured transcript
  - visit outcome / callback status
  - recent rep insights
  - selected team knowledge docs
- Output:
  - title
  - body
  - why_this_matters
  - recommended_next_action
  - confidence
  - method_tags (e.g. straight_line, leader_playbook)

Important product rule
- Knowledge docs should influence the advice, not overwrite the facts.
- Example: Straight Line can shape how we frame the next move, objection handling, certainty, and tonality. It should not hallucinate facts that were never said in the transcript.

Implementation slices
1. Add DB tables for coaching profiles and knowledge docs
2. Add API routes to CRUD profiles/docs
3. Add a resolver that selects the active profile by scope_key
4. Add prompt compiler utilities shared by api-server and hermes-agent
5. Upgrade transcript structuring to accept optional profile context
6. Upgrade webhook coaching generation to use compiled coaching context
7. Add method_tags / why_this_matters into suggestion data payload
8. Add a basic admin UI for managing knowledge docs
9. Add tests for profile resolution, prompt compilation, and coaching output shape

Recommended first slice
- Build profile/doc storage + resolver + prompt compiler
- Keep one active profile for now
- Feed it only into coaching generation first
- After that works, feed a reduced version into transcript structuring

Why this order
- Coaching quality improves immediately
- Lower risk than changing extraction first
- Easier to compare before/after suggestion quality

Verification
- Create one profile for a real rep/team
- Add two docs:
  - internal sales leader playbook
  - Straight Line summary doc
- Replay one known media.transcribed event
- Confirm the bell suggestion changes in wording/recommendation while factual transcript fields remain grounded

Files likely touched first
- lib/db/src/schema/*
- artifacts/api-server/src/routes/agent.ts
- artifacts/api-server/src/lib/transcription.ts
- artifacts/hermes-agent/src/run-webhook.ts
- lib/api-spec/* and generated client/schema packages after contract changes
