/**
 * coaching behavior: analyze a rep's recent visit events for patterns and post
 * one specific, constructive, actionable tip. Unlike debrief (which recaps a
 * single day.ended event), coaching looks ACROSS many visits to surface a trend
 * the rep would not notice in any single interaction.
 *
 * Patterns detected (one per run, most actionable wins):
 *   - cold_streak:   N+ consecutive visits with no positive outcome
 *   - hot_streak:    N+ consecutive closes/positives (reinforcement)
 *   - low_conversion: positive-outcome rate below threshold over enough visits
 *   - low_coverage:  visited few of the available prospects in context
 *
 * The underlying pattern is also persisted as a rep-insight (POST
 * /api/agent/rep-insights) so it compounds across runs.
 *
 * Shape mirrors debrief.ts / nearby-prospect.ts: a pure builder (buildCoaching)
 * with no I/O or hidden clock, wrapped by an I/O shell (runCoaching) that owns
 * run lifecycle so a thrown I/O error still marks the run failed.
 */
import type { HermesClient, RunStatus } from "./client";
import { localDateInZone, zoneOffsetMinutes } from "./proximity";
import type { BusinessCtx, EventItem, SuggestionPayload } from "./types";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export interface CoachingConfig {
  /** IANA zone the rep's local day/week is evaluated in. */
  timeZone: string;
  /** Minimum visit events before coaching fires (need enough data). */
  minVisits: number;
  /** Max events to pull from the feed per run. */
  maxLookback: number;
  /** Ignore events older than this many hours. */
  maxEventAgeHours: number;
  /** Positive-outcome rate below this triggers low_conversion coaching. */
  conversionThreshold: number;
  /** Consecutive non-positive visits before cold_streak coaching. */
  coldStreakThreshold: number;
  /** Consecutive positive visits before hot_streak reinforcement. */
  hotStreakThreshold: number;
  /** Visited-fraction of context prospects below this triggers low_coverage. */
  lowCoverageThreshold: number;
}

export const DEFAULT_COACHING_CONFIG: CoachingConfig = {
  timeZone: "America/Chicago",
  minVisits: 5,
  maxLookback: 50,
  maxEventAgeHours: 168, // 7 days
  conversionThreshold: 0.2,
  coldStreakThreshold: 5,
  hotStreakThreshold: 3,
  lowCoverageThreshold: 0.3,
};

export type CoachingPattern =
  | "cold_streak"
  | "hot_streak"
  | "low_conversion"
  | "low_coverage";

export type CoachingSkipReason =
  | "no_visit_events"
  | "not_enough_visits"
  | "stale_events"
  | "no_actionable_pattern";

export interface RunCoachingOptions {
  client: HermesClient;
  repId?: string;
  /** Defaults to now; injectable for deterministic runs/tests. */
  now?: Date;
  config?: Partial<CoachingConfig>;
  /** When set, the run reports its lifecycle to PATCH /agent/runs/:id. */
  agentRunId?: number;
}

export interface RunCoachingResult {
  posted: number;
  insightPosted?: boolean;
  skipped?: CoachingSkipReason;
  pattern?: CoachingPattern;
  period?: string;
  dedupeKey?: string;
}

// ---------------------------------------------------------------------------
// Outcome parsing (pure)
// ---------------------------------------------------------------------------

const POSITIVE_OUTCOMES = [
  "closed", "won", "close", "deal", "interested", "callback",
  "callback_scheduled", "follow_up", "followup", "qualified", "demo",
  "meeting", "appointment", "yes",
];

const NEGATIVE_OUTCOMES = [
  "not_interested", "rejected", "no", "do_not_call", "not_qualified",
  "disqualified", "refused", "unavailable", "gone",
];

function categorizeOutcome(outcome: string): "positive" | "negative" | "neutral" {
  const o = outcome.toLowerCase().trim();
  // Check negative first: "not_interested" contains "interested", so a
  // positive-first check would mis-classify it.
  if (NEGATIVE_OUTCOMES.some((n) => o.includes(n))) return "negative";
  if (POSITIVE_OUTCOMES.some((p) => o.includes(p))) return "positive";
  return "neutral";
}

/** Extract the outcome string from a visit event's payload. */
function parseOutcome(ev: EventItem): "positive" | "negative" | "neutral" {
  const raw = ev.payload?.outcome;
  if (typeof raw !== "string") return "neutral";
  return categorizeOutcome(raw);
}

// ---------------------------------------------------------------------------
// Pattern analysis (pure)
// ---------------------------------------------------------------------------

export interface VisitAnalysis {
  total: number;
  positives: number;
  negatives: number;
  neutrals: number;
  uniqueBusinesses: number;
  /** Ordered oldest -> newest (feed returns newest-first). */
  outcomes: ("positive" | "negative" | "neutral")[];
  /** Trailing streak of non-positive outcomes, counting from the most recent. */
  coldStreak: number;
  /** Trailing streak of positive outcomes, counting from the most recent. */
  hotStreak: number;
}

export function analyzeVisits(events: EventItem[]): VisitAnalysis {
  // Feed returns newest-first; reverse for chronological analysis.
  const chrono = [...events].reverse();
  const outcomes = chrono.map(parseOutcome);

  let positives = 0;
  let negatives = 0;
  let neutrals = 0;
  const businessIds = new Set<number>();

  for (const ev of chrono) {
    if (ev.businessId != null) businessIds.add(ev.businessId);
  }

  for (const o of outcomes) {
    if (o === "positive") positives++;
    else if (o === "negative") negatives++;
    else neutrals++;
  }

  // Cold streak: consecutive non-positive from the END (most recent).
  let coldStreak = 0;
  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (outcomes[i] === "positive") break;
    coldStreak++;
  }

  // Hot streak: consecutive positive from the END.
  let hotStreak = 0;
  for (let i = outcomes.length - 1; i >= 0; i--) {
    if (outcomes[i] !== "positive") break;
    hotStreak++;
  }

  return {
    total: outcomes.length,
    positives,
    negatives,
    neutrals,
    uniqueBusinesses: businessIds.size,
    outcomes,
    coldStreak,
    hotStreak,
  };
}

/** Positive-outcome rate (interested + closed + callback / total). */
function positiveRate(a: VisitAnalysis): number {
  if (a.total === 0) return 0;
  return a.positives / a.total;
}

// ---------------------------------------------------------------------------
// Pattern selection + card construction (pure)
// ---------------------------------------------------------------------------

export interface CoachingTip {
  pattern: CoachingPattern;
  title: string;
  body: string;
  /** Human-readable insight summary for the rep-insight row. */
  insightSummary: string;
  /** Numeric score 0..1 for the rep-insight (higher = stronger signal). */
  insightScore: number;
}

/**
 * Choose the single most actionable pattern and build the coaching tip.
 * Priority order: cold_streak > low_conversion > hot_streak > low_coverage.
 * Returns null when no pattern meets its threshold.
 */
export function buildCoachingTip(
  analysis: VisitAnalysis,
  cfg: CoachingConfig,
  contextBusinesses?: BusinessCtx[],
): CoachingTip | null {
  const rate = positiveRate(analysis);

  // Cold streak: most urgent actionable signal.
  if (analysis.coldStreak >= cfg.coldStreakThreshold) {
    const n = analysis.coldStreak;
    return {
      pattern: "cold_streak",
      title: `${n} visits without a win — time to adjust`,
      body: `Your last ${n} visits ended without a positive outcome. That's a streak worth breaking. Consider trying a different opening question, asking for the commitment earlier, or revisiting prospects who showed interest earlier this week.`,
      insightSummary: `Cold streak: ${n} consecutive visits with no positive outcome (positive rate ${pct(rate)} over ${analysis.total} visits).`,
      insightScore: clamp01(n / (cfg.coldStreakThreshold * 2)),
    };
  }

  // Low conversion: enough data, low success rate.
  if (
    analysis.total >= cfg.minVisits &&
    rate < cfg.conversionThreshold &&
    analysis.positives < cfg.hotStreakThreshold
  ) {
    return {
      pattern: "low_conversion",
      title: `Positive-outcome rate is ${pct(rate)} — focus on the close`,
      body: `Across your last ${analysis.total} visits, only ${analysis.positives} ended positively (${pct(rate)}). Try sharpening your closing question or scheduling a specific follow-up before you leave the meeting.`,
      insightSummary: `Low conversion: ${pct(rate)} positive-outcome rate over ${analysis.total} visits (${analysis.positives} positive, ${analysis.negatives} negative, ${analysis.neutrals} neutral).`,
      insightScore: clamp01(1 - rate),
    };
  }

  // Hot streak: reinforcement (only when clearly winning).
  if (analysis.hotStreak >= cfg.hotStreakThreshold) {
    const n = analysis.hotStreak;
    return {
      pattern: "hot_streak",
      title: `${n} positive visits in a row — keep it going`,
      body: `You're on a ${n}-visit positive streak. Your approach is working. Note what you're doing differently and keep using it. Consider asking recent prospects for a referral while the momentum is hot.`,
      insightSummary: `Hot streak: ${n} consecutive positive outcomes (positive rate ${pct(rate)} over ${analysis.total} visits).`,
      insightScore: clamp01(n / (cfg.hotStreakThreshold * 2)),
    };
  }

  // Low coverage: only when we have context data.
  if (contextBusinesses && contextBusinesses.length > 0) {
    const coverage = analysis.uniqueBusinesses / contextBusinesses.length;
    if (
      analysis.total >= cfg.minVisits &&
      coverage < cfg.lowCoverageThreshold
    ) {
      return {
        pattern: "low_coverage",
        title: `Visited ${analysis.uniqueBusinesses} of ${contextBusinesses.length} prospects`,
        body: `You've hit ${pct(coverage)} of the available prospects in your territory. Consider expanding your route or revisiting areas you haven't covered yet. Fresh territory often means easier wins.`,
        insightSummary: `Low coverage: ${analysis.uniqueBusinesses} unique prospects visited out of ${contextBusinesses.length} available (${pct(coverage)}).`,
        insightScore: clamp01(1 - coverage),
      };
    }
  }

  return null;
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

// ---------------------------------------------------------------------------
// ISO week helpers
// ---------------------------------------------------------------------------

/**
 * ISO 8601 week key, e.g. "2026-W25". Coaching dedupes per week so a rep
 * gets at most one coaching card per period.
 */
export function isoWeekKey(now: Date, timeZone: string): string {
  const dateStr = localDateInZone(now, timeZone);
  const [y, m, d] = dateStr.split("-").map(Number);
  const localMidnight = new Date(Date.UTC(y, m - 1, d));
  return isoWeekFromDate(localMidnight);
}

function isoWeekFromDate(date: Date): string {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // ISO week: Thursday determines the year.
  const day = tmp.getUTCDay() || 7; // Sunday=0 -> 7
  tmp.setUTCDate(tmp.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(((tmp.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${tmp.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

/**
 * ISO timestamp for the end of the current ISO week (Sunday 23:59:59 local).
 */
export function endOfWeekIso(now: Date, timeZone: string): string {
  const dateStr = localDateInZone(now, timeZone);
  const [y, m, d] = dateStr.split("-").map(Number);
  const localMidnight = new Date(Date.UTC(y, m - 1, d));
  const day = localMidnight.getUTCDay() || 7; // 1=Mon..7=Sun
  // Days until end of week (Sunday): 7 - day
  const daysToSunday = 7 - day;
  const sunday = new Date(Date.UTC(y, m - 1, d + daysToSunday));
  const sy = sunday.getUTCFullYear();
  const sm = String(sunday.getUTCMonth() + 1).padStart(2, "0");
  const sd = String(sunday.getUTCDate()).padStart(2, "0");
  const offsetMin = zoneOffsetMinutes(now, timeZone);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${sy}-${sm}-${sd}T23:59:59${sign}${oh}:${om}`;
}

// ---------------------------------------------------------------------------
// Rep-insight payload (for POST /api/agent/rep-insights)
// ---------------------------------------------------------------------------

export interface RepInsightPayload {
  repId: string;
  type: string;
  summary: string;
  score?: number;
  periodStart?: string;
  periodEnd?: string;
  data?: Record<string, unknown>;
  agentRunId?: number;
}

function buildInsight(
  tip: CoachingTip,
  analysis: VisitAnalysis,
  repId: string,
  period: string,
  periodEnd: string,
  agentRunId?: number,
): RepInsightPayload {
  return {
    repId,
    type: tip.pattern,
    summary: tip.insightSummary,
    score: Number(tip.insightScore.toFixed(3)),
    periodEnd,
    data: {
      period,
      totalVisits: analysis.total,
      positives: analysis.positives,
      negatives: analysis.negatives,
      neutrals: analysis.neutrals,
      coldStreak: analysis.coldStreak,
      hotStreak: analysis.hotStreak,
    },
    agentRunId,
  };
}

// ---------------------------------------------------------------------------
// Card construction
// ---------------------------------------------------------------------------

const TITLE_MAX = 200;
const BODY_MAX = 5000;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}\u2026`;
}

export function buildCoachingCard(opts: {
  repId?: string;
  tip: CoachingTip;
  period: string;
  periodEnd: string;
  agentRunId?: number;
}): SuggestionPayload {
  return {
    type: "coaching",
    title: truncate(opts.tip.title, TITLE_MAX),
    body: truncate(opts.tip.body, BODY_MAX),
    priority: "normal",
    repId: opts.repId,
    dedupeKey: `hermes:coaching:${opts.repId ?? "rep"}:${opts.period}`,
    expiresAt: opts.periodEnd,
    agentRunId: opts.agentRunId,
    data: {
      pattern: opts.tip.pattern,
      period: opts.period,
      insightScore: opts.tip.insightScore,
    },
  };
}

// ---------------------------------------------------------------------------
// I/O shell + run lifecycle
// ---------------------------------------------------------------------------

async function reportRun(
  client: HermesClient,
  agentRunId: number | undefined,
  body: { status: RunStatus; output?: unknown; error?: string },
): Promise<void> {
  if (agentRunId == null) return;
  try {
    await client.patchRun(agentRunId, body);
  } catch {
    // best-effort telemetry
  }
}

function isStale(latestEventAt: string, now: Date, cfg: CoachingConfig): boolean {
  const t = new Date(latestEventAt).getTime();
  if (Number.isNaN(t)) return false;
  return now.getTime() - t > cfg.maxEventAgeHours * 3600_000;
}

export async function runCoaching(
  opts: RunCoachingOptions,
): Promise<RunCoachingResult> {
  const cfg: CoachingConfig = { ...DEFAULT_COACHING_CONFIG, ...opts.config };
  const now = opts.now ?? new Date();

  await reportRun(opts.client, opts.agentRunId, { status: "running" });

  try {
    const result = await execute(opts, cfg, now);
    await reportRun(opts.client, opts.agentRunId, {
      status: result.posted > 0 ? "completed" : "skipped",
      output: {
        posted: result.posted,
        insightPosted: result.insightPosted,
        skipped: result.skipped,
        pattern: result.pattern,
        period: result.period,
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

async function execute(
  opts: RunCoachingOptions,
  cfg: CoachingConfig,
  now: Date,
): Promise<RunCoachingResult> {
  // Pull recent visit events for this rep.
  const events = await opts.client.getEvents({
    type: "visit",
    limit: cfg.maxLookback,
    repId: opts.repId,
  });

  if (events.length === 0) {
    return { posted: 0, skipped: "no_visit_events" };
  }

  if (isStale(events[0].createdAt, now, cfg)) {
    return { posted: 0, skipped: "stale_events" };
  }

  if (events.length < cfg.minVisits) {
    return { posted: 0, skipped: "not_enough_visits" };
  }

  const analysis = analyzeVisits(events);

  // Optionally pull context for coverage analysis.
  let contextBusinesses: BusinessCtx[] | undefined;
  try {
    const ctx = await opts.client.getContext();
    contextBusinesses = ctx.businesses;
  } catch {
    // Coverage is a secondary signal; continue without it.
  }

  const tip = buildCoachingTip(analysis, cfg, contextBusinesses);
  if (!tip) {
    return { posted: 0, skipped: "no_actionable_pattern" };
  }

  const period = isoWeekKey(now, cfg.timeZone);
  const periodEnd = endOfWeekIso(now, cfg.timeZone);

  // Persist the underlying pattern as a rep-insight (compounds across runs).
  const insight = buildInsight(
    tip,
    analysis,
    opts.repId ?? "rep",
    period,
    periodEnd,
    opts.agentRunId,
  );
  let insightPosted = false;
  try {
    await opts.client.postRepInsight(insight);
    insightPosted = true;
  } catch {
    // Insight persistence is advisory; the card still goes out.
  }

  const card = buildCoachingCard({
    repId: opts.repId,
    tip,
    period,
    periodEnd,
    agentRunId: opts.agentRunId,
  });
  await opts.client.postSuggestion(card);

  return {
    posted: 1,
    insightPosted,
    pattern: tip.pattern,
    period,
    dedupeKey: card.dedupeKey,
  };
}
