/**
 * R2 sign/verify + replay-window selftest — pure Node, no build step.
 *
 * Mirrors the exact signing scheme in repo-overlay/artifacts/api-server/src/lib/webhooks.ts
 * so the crypto contract can be validated without the TS toolchain.
 * Run:  node phase3-staging/selftest.mjs   (expect "12 passed, 0 failed")
 *
 * If you change the scheme in webhooks.ts, mirror it here.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

const REPLAY_WINDOW_MS = 5 * 60 * 1000;

function signPayload(secret, signedString) {
  return "sha256=" + createHmac("sha256", secret).update(signedString, "utf8").digest("hex");
}
function verifySignature(secret, signedString, candidate) {
  if (!candidate) return false;
  const a = Buffer.from(signPayload(secret, signedString), "utf8");
  const b = Buffer.from(candidate, "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
function isFreshTimestamp(timestamp, nowMs = Date.now()) {
  if (!timestamp) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return false;
  return Math.abs(nowMs - ts) <= REPLAY_WINDOW_MS;
}

let passed = 0;
let failed = 0;
function check(name, cond) {
  if (cond) { passed++; console.log("  ok  -", name); }
  else { failed++; console.error("  FAIL-", name); }
}

const secret = "test-secret-abc123";
const payload = JSON.stringify({ version: "2026-06-12", eventId: "01J...", eventType: "visit.created" });
const timestamp = Date.now().toString();
const signed = `${timestamp}.${payload}`;
const sig = signPayload(secret, signed);

console.log("R2 selftest — HMAC sign/verify + replay window\n");

// signing round-trip
check("valid signature verifies", verifySignature(secret, signed, sig) === true);
check("wrong secret fails", verifySignature("other-secret", signed, sig) === false);
check("tampered payload fails", verifySignature(secret, `${timestamp}.${payload}X`, sig) === false);
check("empty/missing signature fails", verifySignature(secret, signed, undefined) === false);
check("length-mismatch signature fails", verifySignature(secret, signed, "sha256=deadbeef") === false);
check("signature has sha256= prefix", sig.startsWith("sha256="));

// replay window
const now = Date.now();
check("fresh timestamp (now) passes", isFreshTimestamp(now.toString(), now) === true);
check("4m59s old passes", isFreshTimestamp((now - (REPLAY_WINDOW_MS - 1000)).toString(), now) === true);
check("5m01s old rejected", isFreshTimestamp((now - (REPLAY_WINDOW_MS + 1000)).toString(), now) === false);
check("5m01s future rejected", isFreshTimestamp((now + (REPLAY_WINDOW_MS + 1000)).toString(), now) === false);
check("non-numeric timestamp rejected", isFreshTimestamp("not-a-number", now) === false);
check("missing timestamp rejected", isFreshTimestamp(undefined, now) === false);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
