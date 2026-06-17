# Phase 3 smoke tests

Run these **after** the Phase 3 changeset is live and the server is up. Two parts:

- **`smoke-phase3.mjs`** — fully automated. Exercises the **inbound** signed receiver, **agent
  auth**, and the **app-facing reads**. No app restart needed.
- **`hermes-mock.mjs`** — proves the **outbound** path (app → Hermes). Needs the app pointed at the
  mock + one app restart + an event trigger.

Both are pure Node (>=18), no build step, and reuse the exact contract shipped in
`artifacts/api-server/src/lib/webhook-envelope.ts` (the single source of truth for routes,
headers, and signing — shared by the inbound receiver and the outbound sender).

## Shipped contract (authoritative)

- **Inbound route:** `POST /webhooks/sales-outreach-events` — mounted at **root**, before
  `express.json()` (HMAC needs the raw body). Not under `/api`.
- **Signature:** `x-outreach-signature: sha256=<hex>` — HMAC-SHA256 over the **raw body only**
  (no timestamp prefix), keyed with `HERMES_WEBHOOK_SECRET`.
- **Timestamp:** `x-outreach-timestamp: <unix SECONDS>`, must be within ±5 min.
- **Other headers (sent by the app):** `x-outreach-event`, `x-outreach-event-id`,
  `x-outreach-version`.
- **Envelope:** `{ version:"1", eventId, eventType, occurredAt, source, environment, ... }`.
  `eventType` ∈ `visit.created | visit.updated | media.transcribed | callback.due | day.ended |
  visit.synced_offline`.

---

## 1. Inbound + auth + app-facing (automated)

With the server running and secrets set:

```bash
BASE_URL=http://localhost:$PORT \
AGENT_API_KEY=$AGENT_API_KEY \
HERMES_WEBHOOK_SECRET=$HERMES_WEBHOOK_SECRET \
node phase3-staging/smoke-phase3.mjs
```

What it asserts:

| Check | Expected |
|---|---|
| `GET /api/suggestions` | 200 + array |
| `GET /api/agent/events` (no Bearer) | 401 |
| `GET /api/agent/events` (Bearer) | 200 + array |
| `GET /api/agent/context` (Bearer) | 200 + `{businesses, upcomingCallbacks, generatedAt}` |
| `GET /api/agent/events?since=garbage` | 400 |
| inbound, 6-min-old timestamp | 401 |
| inbound, wrong signature | 401 |
| inbound, invalid `eventType` (bad envelope) | 400 |
| inbound, valid envelope | 200 `{ok:true, duplicate:false, agentRunId}` |
| inbound, replay same `eventId` | 200 `{ok:true, duplicate:true}` |

Add `SMOKE_WRITE=1` to also create + PATCH one test suggestion (uses a stable `dedupeKey`, so
re-runs upsert rather than pile up). Missing `AGENT_API_KEY` or `HERMES_WEBHOOK_SECRET` just skips
that group instead of failing.

Expected tail: `N passed, 0 failed, M skipped` (exit 0).

> Note: inbound error responses carry free-text/zod `{error}` messages (e.g. `"Invalid signature"`,
> `"Stale or missing timestamp"`), so the smoke asserts on **status codes**, not exact strings.

---

## 2. Outbound (app → Hermes) via the mock

Terminal A — start the mock (use the **same** secret the app will use):
```bash
HERMES_WEBHOOK_SECRET=$HERMES_WEBHOOK_SECRET MOCK_PORT=4505 \
node phase3-staging/hermes-mock.mjs
```

Then point the app at it and **restart the app** so it reads the env:
```
HERMES_WEBHOOK_URL=http://localhost:4505/hermes
HERMES_WEBHOOK_SECRET=<same as the mock>
```

Terminal B — trigger any action that calls `logEvent` (creating a visit emits `visit.created`):
```bash
# example — adjust to a real businessId in your DB:
curl -s -X POST localhost:$PORT/api/visits \
  -H "content-type: application/json" \
  -d '{"businessId":1,"outcome":"neutral"}'
```

The mock prints one block per delivery:
```
[#1] /hermes  PASS ✅
  signature: valid   timestamp: fresh   json: ok
  x-outreach-event-id: 7f3a...-uuid
  envelope: version=1 type=visit.created eventId=7f3a...-uuid business.id=1 occurredAt=...
```
`PASS ✅` with `signature: valid` confirms the app built the envelope, signed it correctly, and
delivered it. (`eventId` is a UUID minted per delivery; `business` is a nested object on the
envelope, not a top-level `businessId`.)

When done, restore the real `HERMES_WEBHOOK_URL` (or unset it) and restart the app. If the URL/secret
are unset, outbound is a silent no-op — Phase 2 behavior is unchanged.

---

## Notes
- The **503 unconfigured** inbound case (`HERMES_WEBHOOK_SECRET` unset) can't be checked while the
  secret is set; verify it once by hitting `POST /webhooks/sales-outreach-events` with the secret
  removed (expect `503 {error: "Webhook receiver not configured ..."}`).
- Inbound valid + outbound delivery both insert rows (`agent_event_receipts`, `agent_runs`, an
  `events` row). That's expected smoke residue; the inbound `eventId`s are prefixed `smoke-`.
