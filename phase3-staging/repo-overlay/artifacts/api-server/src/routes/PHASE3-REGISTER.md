# R3 route registration (do this by hand — don't blind-overwrite index.ts)

These four routers must be mounted in the server. Two of them have ordering rules.
The live `routes/index.ts` and server entry weren't available at staging, so apply these
edits against the real files.

## 1. App-facing + agent routers — add to `routes/index.ts`
Wherever the existing Phase 2 routers are registered, add:

```ts
import agentRouter from "./agent";
import suggestionsRouter from "./suggestions";
import insightsRouter from "./insights";

// ...inside the function/place that mounts routers onto the app or parent router:
app.use("/api/agent", agentRouter);          // all endpoints behind requireAgentKey (internal)
app.use("/api/suggestions", suggestionsRouter);
app.use("/api/insights", insightsRouter);
```

(Match the existing mount style — if Phase 2 mounts onto a parent `Router` rather than `app`,
use that. The path prefixes above assume the routers are mounted at the API root.)

## 2. Inbound webhook receiver — MOUNT BEFORE `express.json()`
`webhooks-inbound.ts` needs the raw body for HMAC verification, so it must be registered in the
**server entry** (`app.ts` / `index.ts` / `server.ts`) **before** the global JSON body parser:

```ts
import webhooksInboundRouter from "./routes/webhooks-inbound";

// BEFORE: app.use(express.json());
app.use("/api/webhooks", webhooksInboundRouter);   // POST /api/webhooks/hermes
app.use(express.json());                            // global JSON parser stays AFTER
// ...then the rest of the routers (routes/index.ts) mount here
```

If it is mounted after `express.json()`, the parser consumes the stream and every signature
check fails (the route would see an empty/parsed body, not the raw bytes).

## 3. Sanity after wiring
```
pnpm -r typecheck
# with AGENT_API_KEY + HERMES_WEBHOOK_SECRET set, smoke test:
#   curl -s localhost:PORT/api/suggestions            -> { suggestions: [] }
#   curl -s localhost:PORT/api/agent/events           -> 401 without Bearer
#   curl -s -H "Authorization: Bearer $AGENT_API_KEY" localhost:PORT/api/agent/context?businessId=1
```
