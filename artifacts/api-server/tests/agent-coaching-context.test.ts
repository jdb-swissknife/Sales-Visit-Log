import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";

type DbModule = typeof import("@workspace/db");

const d = process.env.DATABASE_URL ? describe : describe.skip;

const TAG = `CC-CTX-TEST ${Date.now()}`;

d("GET /api/agent/coaching-context — resolution + compilation", () => {
  let dbm: DbModule;
  let repProfileId = 0;
  let globalProfileId = 0;
  const repId = `${TAG}-rep`;
  const profileIds: number[] = [];
  const docIds: number[] = [];

  before(async () => {
    dbm = await import("@workspace/db");

    // Global profile with a custom scopeKey (not 'default') so it won't
    // interfere with the real default profile resolution.
    const [global] = await dbm.db
      .insert(dbm.coachingProfilesTable)
      .values({
        scopeType: "global",
        scopeKey: `g-${TAG}`,
        name: `Global Test Profile (${TAG})`,
        coachingInstructions: "Be direct and specific in coaching.",
        transcriptInstructions: "Capture objections and next steps.",
        enabled: true,
      })
      .returning({ id: dbm.coachingProfilesTable.id });
    globalProfileId = global.id;
    profileIds.push(global.id);

    const docs = await dbm.db
      .insert(dbm.coachingKnowledgeDocsTable)
      .values([
        {
          profileId: globalProfileId,
          title: "Objection Library",
          sourceType: "objection_library",
          methodTag: "erica",
          body: "Price: anchor on value not cost.",
          sortOrder: 200,
          enabled: true,
        },
        {
          profileId: globalProfileId,
          title: "Leader Playbook",
          sourceType: "leader_playbook",
          methodTag: "erica",
          body: "Ready-to-buy leads get same-day follow-up.",
          sortOrder: 100,
          enabled: true,
        },
        {
          profileId: globalProfileId,
          title: "Disabled Doc",
          sourceType: "offer_context",
          methodTag: null,
          body: "This should not appear.",
          sortOrder: 50,
          enabled: false,
        },
        {
          profileId: globalProfileId,
          title: "Straight Line Summary",
          sourceType: "external_framework",
          methodTag: "straight_line",
          body: "Stay on the line: do not let the prospect derail.",
          sortOrder: 300,
          enabled: true,
        },
      ])
      .returning({ id: dbm.coachingKnowledgeDocsTable.id });
    docIds.push(...docs.map((d) => d.id));

    // Rep profile
    const [rep] = await dbm.db
      .insert(dbm.coachingProfilesTable)
      .values({
        scopeType: "rep",
        scopeKey: repId,
        name: `Rep Test Profile (${TAG})`,
        coachingInstructions: "Erica-style: urgent, commission-focused.",
        enabled: true,
      })
      .returning({ id: dbm.coachingProfilesTable.id });
    repProfileId = rep.id;
    profileIds.push(rep.id);

    const [repDoc] = await dbm.db
      .insert(dbm.coachingKnowledgeDocsTable)
      .values({
        profileId: repProfileId,
        title: "HVAC Atlanta Playbook",
        sourceType: "leader_playbook",
        methodTag: "hvac_atlanta",
        body: "Summer is peak HVAC season in Atlanta.",
        sortOrder: 100,
        enabled: true,
      })
      .returning({ id: dbm.coachingKnowledgeDocsTable.id });
    docIds.push(repDoc.id);
  });

  after(async () => {
    if (!dbm) return;
    if (docIds.length > 0) {
      await dbm.db
        .delete(dbm.coachingKnowledgeDocsTable)
        .where(inArray(dbm.coachingKnowledgeDocsTable.id, docIds));
    }
    if (profileIds.length > 0) {
      await dbm.db
        .delete(dbm.coachingProfilesTable)
        .where(inArray(dbm.coachingProfilesTable.id, profileIds));
    }
  });

  async function resolve(repId?: string | null) {
    const { resolveCoachingContext } = await import("../src/lib/coaching-context");
    return resolveCoachingContext(repId);
  }

  it("rep profile beats global profile", async () => {
    const ctx = await resolve(repId);
    assert.ok(ctx.profile, "profile must resolve");
    assert.equal(ctx.profile!.scopeType, "rep");
    assert.equal(ctx.profile!.scopeKey, repId);
    assert.equal(ctx.profile!.name, `Rep Test Profile (${TAG})`);
  });

  it("global fallback works with scopeKey=default when rep not found", async () => {
    const [def] = await dbm.db
      .insert(dbm.coachingProfilesTable)
      .values({
        scopeType: "global",
        scopeKey: "default",
        name: `Temp Default (${TAG})`,
        enabled: true,
      })
      .returning({ id: dbm.coachingProfilesTable.id });
    profileIds.push(def.id);

    try {
      const ctx = await resolve(`nonexistent-${TAG}`);
      assert.ok(ctx.profile, "global fallback must resolve");
      assert.equal(ctx.profile!.scopeType, "global");
      assert.equal(ctx.profile!.scopeKey, "default");
    } finally {
      // cleanup happens in after()
    }
  });

  it("disabled profile does not resolve", async () => {
    const [dis] = await dbm.db
      .insert(dbm.coachingProfilesTable)
      .values({
        scopeType: "rep",
        scopeKey: `disabled-${TAG}`,
        name: `Disabled Rep (${TAG})`,
        enabled: false,
      })
      .returning({ id: dbm.coachingProfilesTable.id });
    profileIds.push(dis.id);

    // The disabled rep profile should be skipped. If no other default exists
    // the result is empty; if a default does exist, it must not be the disabled one.
    const ctx = await resolve(`disabled-${TAG}`);
    if (ctx.profile) {
      assert.notEqual(ctx.profile!.scopeKey, `disabled-${TAG}`);
    } else {
      assert.equal(ctx.profile, null);
    }
  });

  it("disabled docs are excluded", async () => {
    const ctx = await resolve(repId);
    assert.ok(ctx.profile);
    const titles = ctx.knowledgeDocs.map((d) => d.title);
    assert.ok(!titles.includes("Disabled Doc"), "disabled doc must not appear");
  });

  it("docs are sorted by sortOrder asc, id asc", async () => {
    const ctx = await resolve(repId);
    assert.ok(ctx.knowledgeDocs.length >= 1);
    for (let i = 1; i < ctx.knowledgeDocs.length; i++) {
      const prev = ctx.knowledgeDocs[i - 1];
      const curr = ctx.knowledgeDocs[i];
      assert.ok(
        prev.sortOrder < curr.sortOrder ||
          (prev.sortOrder === curr.sortOrder && prev.id < curr.id),
        `doc ${prev.title} (sort=${prev.sortOrder},id=${prev.id}) must come before ${curr.title} (sort=${curr.sortOrder},id=${curr.id})`,
      );
    }
  });

  it("method tags are unique and ordered", async () => {
    const { resolveCoachingContext } = await import("../src/lib/coaching-context");
    // Resolve the global profile docs by checking against globalProfileId directly
    const globalDocs = await dbm.db
      .select()
      .from(dbm.coachingKnowledgeDocsTable)
      .where(eq(dbm.coachingKnowledgeDocsTable.profileId, globalProfileId));
    const enabledSorted = globalDocs
      .filter((d) => d.enabled)
      .sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
    const expectedTags: string[] = [];
    const seen = new Set<string>();
    for (const d of enabledSorted) {
      if (d.methodTag && !seen.has(d.methodTag)) {
        seen.add(d.methodTag);
        expectedTags.push(d.methodTag);
      }
    }
    // Leader Playbook (100, erica) first, Objection Library (200, erica) dup, Straight Line (300, straight_line)
    assert.deepEqual(expectedTags, ["erica", "straight_line"]);

    // Also verify the rep profile methodTags are unique
    const repCtx = await resolveCoachingContext(repId);
    assert.ok(repCtx.methodTags.length > 0);
    const unique = [...new Set(repCtx.methodTags)];
    assert.deepEqual(repCtx.methodTags, unique, "methodTags must be unique");
  });

  it("empty result returns normalized empty shape", async () => {
    const { EMPTY_COACHING_CONTEXT } = await import("../src/lib/coaching-context");
    assert.equal(EMPTY_COACHING_CONTEXT.profile, null);
    assert.deepEqual(EMPTY_COACHING_CONTEXT.knowledgeDocs, []);
    assert.deepEqual(EMPTY_COACHING_CONTEXT.methodTags, []);
    assert.deepEqual(EMPTY_COACHING_CONTEXT.compiled, { transcript: "", coaching: "" });
  });

  it("compiled coaching includes preamble, instructions, and docs", async () => {
    const ctx = await resolve(repId);
    assert.ok(ctx.profile);
    assert.ok(ctx.compiled.coaching.length > 0);
    assert.match(ctx.compiled.coaching, /source of truth/);
    assert.match(ctx.compiled.coaching, /never invent facts/);
    assert.match(ctx.compiled.coaching, /commission-focused/);
    assert.match(ctx.compiled.coaching, /peak HVAC season/);
  });

  it("compiled transcript includes preamble + instructions, not docs", async () => {
    const ctx = await resolve(repId);
    assert.ok(ctx.profile);
    assert.ok(ctx.compiled.transcript.length > 0);
    assert.match(ctx.compiled.transcript, /Extract facts first/);
    assert.doesNotMatch(ctx.compiled.transcript, /peak HVAC season/);
  });
});
