import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";
import { eq, inArray } from "drizzle-orm";

type DbModule = typeof import("@workspace/db");

const d = process.env.DATABASE_URL ? describe : describe.skip;

d("Coaching admin CRUD — /api/coaching/profiles + /api/coaching/docs", () => {
  let dbm: DbModule;
  let server: Server;
  let baseUrl = "";
  const TAG = `CA-TEST ${Date.now()}`;
  const profileIds: number[] = [];
  const docIds: number[] = [];
  let createdProfileId = 0;

  const AUTH = { "x-test-user-id": "test-admin", "x-test-user-role": "owner" };

  async function req(method: string, path: string, body?: unknown) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...AUTH,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const json = res.headers.get("content-type")?.includes("json")
      ? await res.json().catch(() => null)
      : null;
    return { status: res.status, body: json };
  }

  before(async () => {
    process.env.HERMES_WEBHOOK_URL = "";
    const appMod = await import("../src/app");
    dbm = await import("@workspace/db");
    server = appMod.default.listen(0);
    await new Promise<void>((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    // Clean up any remaining docs
    if (dbm && docIds.length > 0) {
      await dbm.db
        .delete(dbm.coachingKnowledgeDocsTable)
        .where(inArray(dbm.coachingKnowledgeDocsTable.id, docIds))
        .catch(() => {});
    }
    // Clean up profiles
    if (dbm && profileIds.length > 0) {
      await dbm.db
        .delete(dbm.coachingProfilesTable)
        .where(inArray(dbm.coachingProfilesTable.id, profileIds))
        .catch(() => {});
    }
    await new Promise<void>((r) => server.close(() => r()));
  });

  // -----------------------------------------------------------------------
  // Profiles
  // -----------------------------------------------------------------------

  it("POST /coaching/profiles creates a profile", async () => {
    const { status, body } = await req("POST", "/api/coaching/profiles", {
      name: `Test Profile (${TAG})`,
      scopeType: "rep",
      scopeKey: `rep-${TAG}`,
      coachingInstructions: "Be urgent and specific.",
      transcriptInstructions: "Capture objections.",
      enabled: true,
    });
    assert.equal(status, 201);
    assert.ok(body.id > 0);
    assert.equal(body.name, `Test Profile (${TAG})`);
    assert.equal(body.scopeType, "rep");
    profileIds.push(body.id);
    createdProfileId = body.id;
  });

  it("GET /coaching/profiles returns the created profile in the list", async () => {
    const { status, body } = await req("GET", "/api/coaching/profiles");
    assert.equal(status, 200);
    const found = body.find((p: any) => p.id === createdProfileId);
    assert.ok(found, "created profile must be in the list");
    assert.equal(found.name, `Test Profile (${TAG})`);
  });

  it("GET /coaching/profiles?scopeType=rep filters by scope", async () => {
    const { status, body } = await req("GET", "/api/coaching/profiles?scopeType=rep");
    assert.equal(status, 200);
    assert.ok(body.every((p: any) => p.scopeType === "rep"));
    assert.ok(body.some((p: any) => p.id === createdProfileId));
  });

  it("GET /coaching/profiles/:id returns profile with empty docs array", async () => {
    const { status, body } = await req("GET", `/api/coaching/profiles/${createdProfileId}`);
    assert.equal(status, 200);
    assert.equal(body.id, createdProfileId);
    assert.ok(Array.isArray(body.docs));
    assert.equal(body.docs.length, 0);
  });

  it("PUT /coaching/profiles/:id updates name and instructions", async () => {
    const { status, body } = await req("PUT", `/api/coaching/profiles/${createdProfileId}`, {
      name: `Updated Profile (${TAG})`,
      enabled: false,
    });
    assert.equal(status, 200);
    assert.equal(body.name, `Updated Profile (${TAG})`);
    assert.equal(body.enabled, false);
  });

  it("POST /coaching/profiles/:id/docs adds a knowledge doc", async () => {
    const { status, body } = await req(
      "POST",
      `/api/coaching/profiles/${createdProfileId}/docs`,
      {
        title: "HVAC Playbook",
        sourceType: "leader_playbook",
        methodTag: "hvac_atlanta",
        body: "Summer is peak season in Atlanta.",
        sortOrder: 100,
        enabled: true,
      },
    );
    assert.equal(status, 201);
    assert.ok(body.id > 0);
    assert.equal(body.title, "HVAC Playbook");
    assert.equal(body.profileId, createdProfileId);
    docIds.push(body.id);
  });

  it("GET /coaching/profiles/:id returns profile with docs after adding", async () => {
    const { status, body } = await req("GET", `/api/coaching/profiles/${createdProfileId}`);
    assert.equal(status, 200);
    assert.ok(body.docs.length >= 1);
    assert.ok(body.docs.some((d: any) => d.title === "HVAC Playbook"));
  });

  it("PUT /coaching/docs/:id updates the doc", async () => {
    const docId = docIds[docIds.length - 1];
    const { status, body } = await req("PUT", `/api/coaching/docs/${docId}`, {
      title: "Updated HVAC Playbook",
      sortOrder: 50,
    });
    assert.equal(status, 200);
    assert.equal(body.title, "Updated HVAC Playbook");
    assert.equal(body.sortOrder, 50);
  });

  it("POST /coaching/profiles/:id/docs 404s for non-existent profile", async () => {
    const { status } = await req("POST", "/api/coaching/profiles/999999/docs", {
      title: "Ghost Doc",
      sourceType: "test",
      body: "should fail",
    });
    assert.equal(status, 404);
  });

  it("POST /coaching/profiles rejects duplicate scopeType + scopeKey (409)", async () => {
    const { status } = await req("POST", "/api/coaching/profiles", {
      name: `Duplicate (${TAG})`,
      scopeType: "rep",
      scopeKey: `rep-${TAG}`,
    });
    assert.equal(status, 409);
  });

  it("GET /coaching/profiles/999999 returns 404", async () => {
    const { status } = await req("GET", "/api/coaching/profiles/999999");
    assert.equal(status, 404);
  });

  it("DELETE /coaching/docs/:id removes the doc", async () => {
    const docId = docIds.pop()!;
    const { status } = await req("DELETE", `/api/coaching/docs/${docId}`);
    assert.equal(status, 204);
    // Verify it's gone
    const { status: s2 } = await req("PUT", `/api/coaching/docs/${docId}`, { title: "x" });
    assert.equal(s2, 404);
  });

  it("DELETE /coaching/profiles/:id cascades to remaining docs", async () => {
    // Add a doc, then delete the profile - doc should cascade-delete
    const { body: doc } = await req(
      "POST",
      `/api/coaching/profiles/${createdProfileId}/docs`,
      {
        title: "Cascade Doc",
        sourceType: "test",
        body: "should be deleted with profile",
      },
    );
    // Don't track this docId for cleanup since cascade will handle it
    assert.ok(doc.id > 0);

    const { status } = await req("DELETE", `/api/coaching/profiles/${createdProfileId}`);
    assert.equal(status, 204);

    // Profile is gone
    const { status: s2 } = await req("GET", `/api/coaching/profiles/${createdProfileId}`);
    assert.equal(s2, 404);

    // Doc also gone via cascade
    if (dbm) {
      const [row] = await dbm.db
        .select()
        .from(dbm.coachingKnowledgeDocsTable)
        .where(eq(dbm.coachingKnowledgeDocsTable.id, doc.id));
      assert.ok(!row, "doc must be cascade-deleted with profile");
    }

    // Remove from profileIds so after() doesn't try to delete again
    const idx = profileIds.indexOf(createdProfileId);
    if (idx >= 0) profileIds.splice(idx, 1);
  });

  it("rejects unauthenticated requests (no x-test-user-id)", async () => {
    const res = await fetch(`${baseUrl}/api/coaching/profiles`);
    assert.equal(res.status, 401);
  });
});
