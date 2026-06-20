/**
 * nearby_prospect orchestration: find the rep's last-known anchor, rank nearby
 * eligible prospects, and post the top cards. Pure logic lives in proximity.ts;
 * this file is the I/O shell. Run lifecycle (running/completed/skipped/failed)
 * is reported here so a thrown I/O error still marks the run failed.
 */
import type { HermesClient, RunStatus } from "./client";
import {
  DEFAULT_NEARBY_CONFIG,
  buildSuggestion,
  isWithinDropInWindow,
  rankNearby,
  type NearbyConfig,
} from "./proximity";
import type { BusinessCtx } from "./types";

export type SkipReason =
  | "outside_drop_in_window"
  | "no_recent_visit"
  | "anchor_not_in_context"
  | "anchor_missing_coords"
  | "no_eligible_nearby";

export interface RunNearbyOptions {
  client: HermesClient;
  repId?: string;
  /** Defaults to now; injectable for deterministic runs/tests. */
  now?: Date;
  config?: Partial<NearbyConfig>;
  /** When set, the run reports its lifecycle to PATCH /agent/runs/:id. */
  agentRunId?: number;
}

export interface RunNearbyResult {
  posted: number;
  skipped?: SkipReason;
  anchorBusinessId?: number;
  cards: { businessId: number; distanceMi: number; priorityScore: number }[];
}

/**
 * Report a run's lifecycle to PATCH /agent/runs/:id. Telemetry is advisory: a
 * failure here must never discard an otherwise-successful run, nor mask the
 * original error of a failing one, so its errors are swallowed.
 */
async function reportRun(
  client: HermesClient,
  agentRunId: number | undefined,
  body: { status: RunStatus; output?: unknown; error?: string },
): Promise<void> {
  if (agentRunId == null) return;
  try {
    await client.patchRun(agentRunId, body);
  } catch {
    // intentionally ignored — run status reporting is best-effort
  }
}

export async function runNearbyProspect(
  opts: RunNearbyOptions,
): Promise<RunNearbyResult> {
  const cfg: NearbyConfig = { ...DEFAULT_NEARBY_CONFIG, ...opts.config };
  const now = opts.now ?? new Date();

  await reportRun(opts.client, opts.agentRunId, { status: "running" });

  try {
    const result = await execute(opts, cfg, now);
    await reportRun(opts.client, opts.agentRunId, {
      status: result.posted > 0 ? "completed" : "skipped",
      output: {
        posted: result.posted,
        skipped: result.skipped,
        anchorBusinessId: result.anchorBusinessId,
      },
    });
    return result;
  } catch (err) {
    await reportRun(opts.client, opts.agentRunId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * The behavior's core logic. Throws on I/O failure; the caller owns lifecycle
 * reporting so a failed run is always recorded.
 */
async function execute(
  opts: RunNearbyOptions,
  cfg: NearbyConfig,
  now: Date,
): Promise<RunNearbyResult> {
  if (!isWithinDropInWindow(now, cfg)) {
    return { posted: 0, skipped: "outside_drop_in_window", cards: [] };
  }

  const recentVisits = await opts.client.getEvents({
    type: "visit",
    limit: 1,
    repId: opts.repId,
  });
  const anchorEvent = recentVisits[0];
  const anchorBusinessId = anchorEvent?.businessId;
  if (!anchorBusinessId) {
    return { posted: 0, skipped: "no_recent_visit", cards: [] };
  }

  const context = await opts.client.getContext();
  const byId = new Map<number, BusinessCtx>(
    context.businesses.map((b) => [b.id, b]),
  );
  const anchor = byId.get(anchorBusinessId);
  if (!anchor) {
    return {
      posted: 0,
      skipped: "anchor_not_in_context",
      anchorBusinessId,
      cards: [],
    };
  }
  if (anchor.latitude == null || anchor.longitude == null) {
    return {
      posted: 0,
      skipped: "anchor_missing_coords",
      anchorBusinessId,
      cards: [],
    };
  }

  const matches = rankNearby(
    { latitude: anchor.latitude, longitude: anchor.longitude },
    anchor.id,
    context.businesses,
    cfg,
  ).slice(0, cfg.maxCards);

  if (matches.length === 0) {
    return {
      posted: 0,
      skipped: "no_eligible_nearby",
      anchorBusinessId,
      cards: [],
    };
  }

  const cards: RunNearbyResult["cards"] = [];
  for (const m of matches) {
    const payload = buildSuggestion(m, {
      repId: opts.repId,
      anchorName: anchor.name,
      anchorBusinessId: anchor.id,
      now,
      cfg,
      agentRunId: opts.agentRunId,
    });
    await opts.client.postSuggestion(payload);
    cards.push({
      businessId: m.business.id,
      distanceMi: Number(m.distanceMi.toFixed(2)),
      priorityScore: m.priorityScore,
    });
  }

  return { posted: cards.length, anchorBusinessId, cards };
}
