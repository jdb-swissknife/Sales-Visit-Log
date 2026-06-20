/**
 * Pure geo + eligibility + payload logic for the nearby_prospect behavior.
 * No I/O, no Date.now hidden anywhere — every function takes its inputs, so the
 * whole rule is deterministically testable.
 */
import type {
  BusinessCtx,
  Priority,
  SuggestionPayload,
  SuggestionPriority,
} from "./types";

export interface LatLng {
  latitude: number;
  longitude: number;
}

export interface NearbyConfig {
  /** Max distance (miles) from the anchor for a card to fire. */
  radiusMi: number;
  /** Inclusive local hour the drop-in window opens. */
  dropInStartHour: number;
  /** Exclusive local hour the drop-in window closes (also the card's expiry). */
  dropInEndHour: number;
  /** IANA zone the rep's local time is evaluated in. */
  timeZone: string;
  /** Max cards a single run may produce. */
  maxCards: number;
  /** Statuses that disqualify a business even if otherwise eligible. */
  excludeStatuses: string[];
  /** Ranking weight per priority bucket. */
  priorityWeights: Record<Priority, number>;
}

export const DEFAULT_NEARBY_CONFIG: NearbyConfig = {
  radiusMi: 1.0,
  dropInStartHour: 9,
  dropInEndHour: 17,
  timeZone: "America/Chicago",
  maxCards: 3,
  excludeStatuses: [],
  priorityWeights: { high: 1.0, medium: 0.5, low: 0.2 },
};

const EARTH_RADIUS_MI = 3958.7613;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Great-circle distance in miles between two points. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Hour (0–23) of `now` in the configured time zone. */
export function localHourInZone(now: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hour12: false,
  });
  // "24" can appear at midnight in some environments; normalize to 0.
  return Number(fmt.format(now)) % 24;
}

/** Local calendar date (YYYY-MM-DD) of `now` in the configured time zone. */
export function localDateInZone(now: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(now); // en-CA yields YYYY-MM-DD
}

/** Is `now` inside [dropInStartHour, dropInEndHour) in local time? */
export function isWithinDropInWindow(now: Date, cfg: NearbyConfig): boolean {
  const h = localHourInZone(now, cfg.timeZone);
  return h >= cfg.dropInStartHour && h < cfg.dropInEndHour;
}

function normalizePriority(p: string): Priority {
  return p === "high" || p === "medium" || p === "low" ? p : "medium";
}

function hasCoords(b: BusinessCtx): b is BusinessCtx & LatLng {
  return typeof b.latitude === "number" && typeof b.longitude === "number";
}

/**
 * Eligible = has coords, not the anchor, not in excludeStatuses, and either
 * un-visited (not_contacted) or high-priority.
 */
export function isEligible(
  b: BusinessCtx,
  anchorId: number,
  cfg: NearbyConfig,
): boolean {
  if (!hasCoords(b)) return false;
  if (b.id === anchorId) return false;
  if (cfg.excludeStatuses.includes(b.status)) return false;
  const unvisited = b.status === "not_contacted";
  const highPriority = normalizePriority(b.priority) === "high";
  return unvisited || highPriority;
}

export interface NearbyMatch {
  business: BusinessCtx;
  distanceMi: number;
  priorityScore: number;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

/** Filter to eligible-and-within-radius, score, and sort best-first. */
export function rankNearby(
  anchor: LatLng,
  anchorId: number,
  businesses: BusinessCtx[],
  cfg: NearbyConfig,
): NearbyMatch[] {
  const matches: NearbyMatch[] = [];
  for (const b of businesses) {
    if (!isEligible(b, anchorId, cfg)) continue;
    const distanceMi = haversineMiles(anchor, {
      latitude: b.latitude as number,
      longitude: b.longitude as number,
    });
    if (distanceMi > cfg.radiusMi) continue;
    const closeness = clamp01(1 - distanceMi / cfg.radiusMi);
    const weight = cfg.priorityWeights[normalizePriority(b.priority)];
    const priorityScore = clamp01(0.6 * closeness + 0.4 * weight);
    matches.push({ business: b, distanceMi, priorityScore });
  }
  matches.sort((a, b) => b.priorityScore - a.priorityScore);
  return matches;
}

function statusLabel(status: string): string {
  if (status === "not_contacted") return "Un-visited";
  return status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/** Build the suggestion card body for a match. Grounded — no invented facts. */
export function buildSuggestion(
  match: NearbyMatch,
  opts: {
    repId?: string;
    anchorName: string;
    anchorBusinessId: number;
    now: Date;
    cfg: NearbyConfig;
    agentRunId?: number;
  },
): SuggestionPayload {
  const { business: b, distanceMi, priorityScore } = match;
  const priority = normalizePriority(b.priority);
  const dist = distanceMi.toFixed(1);
  const localDate = localDateInZone(opts.now, opts.cfg.timeZone);

  const descriptor =
    priority === "high"
      ? `${statusLabel(b.status).toLowerCase()} high-priority prospect`
      : `${statusLabel(b.status).toLowerCase()} prospect`;
  const where = b.address ? ` ${b.address}.` : "";
  const cardPriority: SuggestionPriority = priority === "high" ? "high" : "normal";

  return {
    type: "nearby_prospect",
    title: `${b.name} is ${dist} mi away`,
    body: `${capitalize(descriptor)} about ${dist} mi from your last stop (${opts.anchorName}).${where}`,
    priority: cardPriority,
    businessId: b.id,
    repId: opts.repId,
    priorityScore: Number(priorityScore.toFixed(3)),
    dedupeKey: `hermes:nearby:${opts.repId ?? "rep"}:${b.id}:${localDate}`,
    actionLabel: "Open prospect",
    actionUrl: `/businesses/${b.id}`,
    expiresAt: endOfWindowIso(opts.now, opts.cfg),
    agentRunId: opts.agentRunId,
    data: {
      distanceMi: Number(distanceMi.toFixed(2)),
      anchorBusinessId: opts.anchorBusinessId,
      anchorName: opts.anchorName,
    },
  };
}

function capitalize(s: string): string {
  return s.replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * ISO timestamp (with offset) for today's drop-in close in the rep's zone.
 * Computed by finding the zone's UTC offset at `now` and applying it.
 */
export function endOfWindowIso(now: Date, cfg: NearbyConfig): string {
  const date = localDateInZone(now, cfg.timeZone); // YYYY-MM-DD local
  const offsetMin = zoneOffsetMinutes(now, cfg.timeZone);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  const hh = String(cfg.dropInEndHour).padStart(2, "0");
  return `${date}T${hh}:00:00${sign}${oh}:${om}`;
}

/** Minutes east of UTC for `timeZone` at instant `now`. */
export function zoneOffsetMinutes(now: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = dtf.formatToParts(now);
  const map: Record<string, number> = {};
  for (const p of parts) if (p.type !== "literal") map[p.type] = Number(p.value);
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour % 24,
    map.minute,
    map.second,
  );
  return Math.round((asUtc - now.getTime()) / 60000);
}
