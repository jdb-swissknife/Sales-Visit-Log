/**
 * POST /api/agent/runs — the harness-facing surface that opens a tracked run
 * for a scheduled behavior (no inbound webhook). DB-gated like the other agent
 * tests: only runs when DATABASE_URL is configured.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

type DbModule = typeof import("@workspace/db");

const d = process.env.DATABASE_URL ? describe : describe.skip;

d("POST /api/agent/runs — open a run", () => {
  let dbm: DbModule;
  let server: Server;
  let baseUrl = "";
  const KEY = "test-agent-key";

  const post = async (body: unknown, auth = true) => {
    const res = await fetch(`${baseUrl}/api/agent/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(auth ? { authorization: `Bearer ${KEY}` } : {}),
      },
      body: JSON.stringify(body),
    });
    let json: any = null;
    try { json = await res.json(); } catch { /* no body */ }
    return { status: res.status, body: json };
  };

  before(async () => {
    process.env.AGENT_API_KEY = KEY;
    process.env.HERMES_WEBHOOK_URL = "";
    const appMod = await import("../src/app");
    dbm = await import("@workspace/db");
    server = appMod.default.listen(0);
    await new Promise<void>((r) => server.once("listening", r));
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("401s without the agent key", async () => {
    const { status } = await post({ eventType: "nearby_prospect.scheduled" }, false);
    assert.equal(status, 401);
  });

  it("creates a queued run and returns its id (eventId auto-generated)", async () => {
    const { status, body } = await post({ eventType: "nearby_prospect.scheduled" });
    assert.equal(status, 201);
    assert.ok(Number.isInteger(body.id), "expected a numeric run id");
    assert.equal(body.status, "queued");
    assert.equal(body.eventType, "nearby_prospect.scheduled");
    assert.ok(typeof body.eventId === "string" && body.eventId.length > 0);
    assert.equal(body.startedAt, null);

    // The row is real: PATCH it and confirm it transitions.
    const patch = await fetch(`${baseUrl}/api/agent/runs/${body.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${KEY}` },
      body: JSON.stringify({ status: "completed", output: { posted: 0 } }),
    });
    assert.equal(patch.status, 200);
    const patched = (await patch.json()) as any;
    assert.equal(patched.status, "completed");
    assert.ok(patched.finishedAt);
  });

  it("honors status=running by stamping startedAt", async () => {
    const { status, body } = await post({
      eventType: "nearby_prospect.scheduled",
      eventId: `test-run:${Date.now()}`,
      status: "running",
    });
    assert.equal(status, 201);
    assert.equal(body.status, "running");
    assert.ok(body.startedAt, "running run must stamp startedAt");
  });

  it("400s on a missing eventType", async () => {
    const { status } = await post({ eventId: "no-type" });
    assert.equal(status, 400);
  });
});
