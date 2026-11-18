import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHmac } from "node:crypto";
import express from "express";

test("local sign-in, session protection, password rotation and rate limits", async () => {
  const dir = mkdtempSync(join(tmpdir(), "svl-auth-test-"));
  process.env.SVL_AUTH_FILE = join(dir, "auth.json");
  const secret = "test-only-".repeat(8);
  writeFileSync(process.env.SVL_AUTH_FILE, JSON.stringify({ sessionSecret: secret, users: [] }), { mode: 0o600 });
  const auth = await import("../src/middlewares/local-auth");
  writeFileSync(process.env.SVL_AUTH_FILE, JSON.stringify({ sessionSecret: secret, users: [{ id: "existing-owner-id", username: "jb@trustmvs.com", name: "JB", role: "owner", passwordHash: auth.hashPassword("OriginalPassword!123"), sessionVersion: 1 }] }));
  const { default: routes } = await import("../src/routes/auth");
  const app = express(); app.use(express.json()); app.use(auth.sessionContext); app.use("/api", routes);
  app.get("/private", auth.requireAuth, (req, res) => res.json({ id: req.userId, role: req.userRole }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>(r => server.once("listening", r));
  const addr = server.address() as { port: number }; const base = `http://127.0.0.1:${addr.port}`;
  async function post(path: string, body: object, cookie = "", ip = "test-client") { return fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json", cookie, "cf-connecting-ip": ip }, body: JSON.stringify(body) }); }
  try {
    assert.equal((await fetch(base + "/private")).status, 401);
    assert.equal((await fetch(base + "/private", { headers: { "x-test-user-id": "owner", "x-test-user-role": "owner" } })).status, 401);
    assert.equal((await post("/api/auth/login", { username: "jb@trustmvs.com", password: "incorrect" })).status, 401);
    assert.equal((await post("/api/auth/login", { username: "unknown", password: "incorrect" })).status, 401);
    const login = await post("/api/auth/login", { username: "JB@TRUSTMVS.COM", password: "OriginalPassword!123" });
    assert.equal(login.status, 200);
    const setCookie = login.headers.get("set-cookie")!; assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /Secure/); assert.match(setCookie, /SameSite=Lax/i);
    const cookie = setCookie.split(";")[0];
    const me = await fetch(base + "/api/auth/me", { headers: { cookie } }); assert.equal(me.status, 200); const info = await me.json(); assert.equal(info.user.username, "jb@trustmvs.com"); assert.equal(info.user.passwordHash, undefined);
    const privateResponse = await fetch(base + "/private", { headers: { cookie } }); assert.deepEqual(await privateResponse.json(), { id: "existing-owner-id", role: "owner" });
    assert.equal((await fetch(base + "/private", { headers: { cookie: cookie + "tampered" } })).status, 401);
    const body = Buffer.from(JSON.stringify({ sub: "existing-owner-id", version: 1, exp: 1 })).toString("base64url");
    const expired = `svl_session=${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`;
    assert.equal((await fetch(base + "/private", { headers: { cookie: expired } })).status, 401);
    assert.equal((await post("/api/auth/password", { currentPassword: "wrong", newPassword: "NewPassword!12345" }, cookie)).status, 401);
    assert.equal((await post("/api/auth/password", { currentPassword: "OriginalPassword!123", newPassword: "short" }, cookie)).status, 400);
    const changed = await post("/api/auth/password", { currentPassword: "OriginalPassword!123", newPassword: "NewPassword!12345" }, cookie); assert.equal(changed.status, 200);
    const newCookie = changed.headers.get("set-cookie")!.split(";")[0];
    assert.equal((await fetch(base + "/private", { headers: { cookie } })).status, 401);
    assert.equal((await fetch(base + "/private", { headers: { cookie: newCookie } })).status, 200);
    assert.equal((await post("/api/auth/login", { username: "jb@trustmvs.com", password: "OriginalPassword!123" })).status, 401);
    assert.equal((await post("/api/auth/login", { username: "jb@trustmvs.com", password: "NewPassword!12345" })).status, 200);
    const logout = await post("/api/auth/logout", {}, newCookie); assert.match(logout.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
    for (let i = 0; i < 10; i++) assert.equal((await post("/api/auth/login", { username: "unknown", password: "incorrect" }, "", "rate-test")).status, 401);
    assert.equal((await post("/api/auth/login", { username: "unknown", password: "incorrect" }, "", "rate-test")).status, 429);
  } finally { await new Promise<void>(r => server.close(() => r())); rmSync(dir, { recursive: true, force: true }); }
});
