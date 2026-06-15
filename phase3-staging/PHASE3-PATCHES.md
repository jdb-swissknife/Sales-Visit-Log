# Phase 3 — live-file patches & activation notes (verified 2026-06-14)

The shell-free prep is done. The `repo-overlay/` is now **activation-ready**: the two
"couldn't-verify-at-staging" items were checked against **live GitHub `main`** and resolved.
`activate-replit.sh` applies everything below automatically; this doc is the human source of
truth and the manual fallback if a scripted anchor ever drifts.

---

## What changed vs. the staged bundle

### Verified against live schema (and already fixed in the overlay)
- **`zod/v4` import** — confirmed correct. The live Phase 2 schema files (`events.ts`,
  `businesses.ts`, …) all `import { z } from "zod/v4"`, so the overlay matches. No change needed.
- **`agent.ts` GET /events** — was a `501` stub; now implemented against the live `eventsTable`
  (`createdAt` + standard columns). Added `gt` to the drizzle import.
- **`agent.ts` GET /context** — now enriches with `business`, `visits`, `notes`.
  **Key correction:** the staged sketch read `notesTable.businessId`, **but `notes` has no
  `businessId`** — it references `visitId`. Notes for a business are now fetched by **joining
  `notes → visits` and filtering `visits.businessId`**. (This would have failed typecheck as written.)

### Three live-repo files still need editing at activation (the script does these)
These files live in the Phase 2 baseline, not in the overlay, so they're patched in place.

---

## Patch 2a — `artifacts/api-server/src/lib/events.ts` (the R2 outbound hook)

**Why it differs from ACTIVATION.md:** the live `logEvent` returns `void`, the events table uses
an **integer serial `id`** (no ULID), and there is **no `repId` / `correlationId` / `occurredAt`**.
So the hook must (a) capture the inserted id via `.returning()`, (b) stringify it for the
envelope's text `eventId`, (c) use the real `createdAt` for `occurredAt`, and (d) pass
`payload` straight through as `data` (the envelope is passthrough, so `aiStructured` / `daySummary`
ride along automatically when present).

Add the import:
```ts
import { logger } from "./logger";
import { fireWebhook } from "./webhooks";   // <-- add
```

Replace the insert inside `logEvent`:
```ts
// BEFORE
    await db.insert(eventsTable).values({
      type: input.type,
      entityType: input.entityType ?? null,
      entityId: input.entityId ?? null,
      businessId: input.businessId ?? null,
      visitId: input.visitId ?? null,
      payload: input.payload ?? null,
      source: input.source ?? "server",
    });
```
```ts
// AFTER
    const [row] = await db
      .insert(eventsTable)
      .values({
        type: input.type,
        entityType: input.entityType ?? null,
        entityId: input.entityId ?? null,
        businessId: input.businessId ?? null,
        visitId: input.visitId ?? null,
        payload: input.payload ?? null,
        source: input.source ?? "server",
      })
      .returning({ id: eventsTable.id, createdAt: eventsTable.createdAt });

    // R2: fire-and-forget outbound webhook to Hermes. Never throws; cannot break logEvent.
    fireWebhook({
      eventId: String(row.id),
      eventType: input.type,
      occurredAt: new Date(row.createdAt).toISOString(),
      businessId: input.businessId ?? null,
      data: (input.payload ?? {}) as Record<string, unknown>,
    });
```
`fireWebhook` is a no-op until `HERMES_WEBHOOK_URL`/`_SECRET` are set, and it swallows all errors —
so this is safe to ship even before Hermes is live.

---

## Patch 2b — `artifacts/api-server/src/routes/index.ts` (register R3 app/agent routers)

The live aggregate router mounts sub-routers **without prefixes** and is itself mounted at
`/api` (in `app.ts`). So the R3 routers get their prefixes here:

```ts
import eventsRouter from "./events";
import agentRouter from "./agent";              // <-- add
import suggestionsRouter from "./suggestions";  // <-- add
import insightsRouter from "./insights";        // <-- add
// ...
router.use(eventsRouter);
router.use("/agent", agentRouter);              // -> /api/agent/*      (behind requireAgentKey)
router.use("/suggestions", suggestionsRouter);  // -> /api/suggestions/*
router.use("/insights", insightsRouter);        // -> /api/insights/*
```

Resulting paths: `/api/agent/{events,context,suggestions,runs/:id,prospect-insights,rep-insights}`,
`/api/suggestions` + `/api/suggestions/:id` + `/api/suggestions/stream`,
`/api/insights/prospect` + `/api/insights/rep`.

---

## Patch 2c — `artifacts/api-server/src/app.ts` (inbound receiver BEFORE `express.json()`)

The inbound receiver uses `express.raw(...)` for HMAC, so it must be mounted **before** the global
JSON parser, otherwise the parser eats the stream and every signature check fails.

```ts
import router from "./routes";
import webhooksInboundRouter from "./routes/webhooks-inbound";   // <-- add
// ...
app.use(cors());
// R3 inbound receiver needs the RAW body for HMAC — must precede express.json().
app.use("/api/webhooks", webhooksInboundRouter);                // <-- add (POST /api/webhooks/hermes)
app.use(express.json());                                        // stays AFTER
app.use(express.urlencoded({ extended: true }));
app.use("/api", router);
```

---

## Getting the bundle onto Replit (the one manual bridge)

The overlay currently lives only in your OneDrive folder (Phase 3 has never been in git). To run
the script on Replit you need `phase3-staging/` present at the repo root there. Easiest:

1. Zip the `phase3-staging` folder locally.
2. Upload + unzip it at the root of your Replit clone (or `git add` it on a branch and pull).
3. From the repo root on Replit:  `bash phase3-staging/activate-replit.sh`
   - dry run first (no DB write, no push):  `SKIP_DB=1 bash phase3-staging/activate-replit.sh`
   - when happy, push:  `PUSH=1 bash phase3-staging/activate-replit.sh`

The script is idempotent — re-running skips already-applied patches, so a dry run then a real run
is safe.

---

## Locked decisions unchanged
Integer serial PKs; ULIDs only in text fields; `WEBHOOK_VERSION = "2026-06-12"`; priority
`medium`→`normal` on input; HMAC-SHA256 over `${timestamp}.${payload}`, `sha256=<hex>`, ±5 min
replay window; no LLM calls in the backend.
