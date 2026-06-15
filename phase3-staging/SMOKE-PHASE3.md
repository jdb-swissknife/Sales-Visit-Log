# Phase 3 smoke tests

Run these **after** `activate-replit.sh` succeeds and the server is up. Two parts:

- **`smoke-phase3.mjs`** — fully automated. Exercises the **inbound** signed receiver, **agent
  auth**, and the **app-facing reads**. No app restart needed.
- **`hermes-mock.mjs`** — proves the **outbound** path (app → Hermes). Needs the app pointed at the
  mock + one app restart + an event trigger.

Both are pure Node (>=18), no build step, and reuse the exact signing scheme in `webhooks.ts`.

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
| `GET /api/suggestions` | 200 + `suggestions` array |
| `GET /api/insights/prospect?businessId=1` | 200 + `insights` array |
| `GET /api/agent/events` (no Bearer) | 401 |
| `GET /api/agent/events` (Bearer) | 200 + `events` array |
| `GET /api/agent/context?businessId=1` | 200 + `{business, visits, notes, insights, suggestions}` |
| `GET /api/agent/events?since=garbage` | 400 |
| inbound, 6-min-old timestamp | 401 `stale_timestamp` |
| inbound, wrong signature | 401 `invalid_signature` |
| inbound, string `businessId` | 400 `invalid_envelope` |
| inbound, valid envelope | 200 `queued:true` (+ `runId`) |
| inbound, replay same `eventId` | 200 `duplicate:true` |

Add `SMOKE_WRITE=1` to also create + PATCH one test suggestion (uses a stable `dedupeKey`, so
re-runs upsert rather than pile up). Missing `AGENT_API_KEY` or `HERMES_WEBHOOK_SECRET` just skips
that group instead of failing.

Expected tail: `N passed, 0 failed, M skipped` (exit 0).

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
  x-hermes-event-id: 1234
  envelope: version=2026-06-12 type=visit.created eventId=1234 businessId=1 occurredAt=...
```
`PASS ✅` with `signature: valid` confirms the app built the envelope, signed it correctly, and
delivered it. (`eventId` is the stringified serial event id — the verified hook behavior.)

When done, restore the real `HERMES_WEBHOOK_URL` (or unset it) and restart the app. If the URL/secret
are unset, outbound is a silent no-op — Phase 2 behavior is unchanged.

---

## Notes
- The **503 unconfigured** inbound case (`HERMES_WEBHOOK_SECRET` unset) can't be checked while the
  secret is set; verify it once by hitting `/api/webhooks/hermes` with the secret removed.
- Inbound valid + outbound delivery both insert rows (`agent_event_receipts`, `agent_runs`, an
  `events` row). That's expected smoke residue; the inbound `eventId`s are prefixed `smoke-`.
