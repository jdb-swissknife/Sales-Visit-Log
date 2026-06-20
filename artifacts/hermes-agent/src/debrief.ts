/**
 * debrief behavior: at day's end, post one rep-level card summarizing the day
 * and naming 2-3 focused priorities for tomorrow.
 *
 * Trigger is the rep's most-recent `day.ended` event (read from the rep-scoped
 * feed); its `payload` is the app's free-form `daySummary`. Because the summary
 * is free-form, parsing is deliberately tolerant: we pull a small set of
 * well-known keys (with synonyms) and ground the card only in what we actually
 * find — no invented numbers, no invented follow-ups.
 *
 * Shape mirrors nearby-prospect.ts: a pure builder (buildDebrief) with no I/O or
 * hidden clock, wrapped by an I/O shell (runDebrief) that owns run lifecycle so
 * a thrown I/O error still marks the run failed.
 */
import type { HermesClient, RunStatus } from "./client";
import { localDateInZone, zoneOffsetMinutes } from "./proximity";
import type { SuggestionPayload } from "./types";

export interface DebriefConfig {
  /** IANA zone the rep's local day/date is evaluated in. */
  timeZone: string;
  /** Max priorities listed on the card. */
  maxPriorities: number;
  /**
   * Ignore a day.ended event older than this many hours. Guards against
   * debriefing a long-past day when the scheduler runs and the rep has not
   * ended a day since. Dedupe already prevents same-day stacking.
   */
  maxStaleHours: number;
}

export const DEFAULT_DEBRIEF_CONFIG: DebriefConfig = {
  timeZone: "America/Chicago",
  maxPriorities: 3,
  maxStaleHours: 36,
};

export type DebriefSkipReason =
  | "no_day_ended"
  | "stale_day_ended"
  | "empty_day_summary";

export interface RunDebriefOptions {
  client: HermesClient;
  repId?: string;
  /** Defaults to now; injectable for deterministic runs/tests. */
  now?: Date;
  config?: Partial<DebriefConfig>;
  /** When set, the run reports its lifecycle to PATCH /agent/runs/:id. */
  agentRunId?: number;
}

export interface RunDebriefResult {
  posted: number;
  skipped?: DebriefSkipReason;
  date?: string;
  dedupeKey?: string;
}

// ---------------------------------------------------------------------------
// Tolerant daySummary parsing (pure)
// ---------------------------------------------------------------------------

interface ParsedSummary {
  visits?: number;
  closes?: number;
  newProspects?: number;
  callbacks?: number;
  outcomes?: Record<string, number>;
  priorities: string[];
  date?: string; // YYYY-MM-DD, only when the summary supplied a usable one
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

/** First finite number found across the given keys. */
function pickNum(
  obj: Record<string, unknown>,
  keys: string[],
): number | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return undefined;
}

/** First string[] found across the keys; non-string entries are dropped. */
function pickStrList(
  obj: Record<string, unknown>,
  keys: string[],
): string[] | undefined {
  for (const k of keys) {
    const v = obj[k];
    if (Array.isArray(v)) {
      const list = v
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (list.length > 0) return list;
    }
  }
  return undefined;
}

/** A record of name->count (drops non-numeric / non-positive entries). */
function pickNumMap(
  obj: Record<string, unknown>,
  keys: string[],
): Record<string, number> | undefined {
  for (const k of keys) {
    const rec = asRecord(obj[k]);
    if (!rec) continue;
    const out: Record<string, number> = {};
    for (const [name, val] of Object.entries(rec)) {
      if (typeof val === "number" && Number.isFinite(val) && val > 0) {
        out[name] = val;
      }
    }
    if (Object.keys(out).length > 0) return out;
  }
  return undefined;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;

function pickDate(obj: Record<string, unknown>): string | undefined {
  for (const k of ["date", "dateLocal", "day", "localDate"]) {
    const v = obj[k];
    if (typeof v === "string" && DATE_RE.test(v)) return v.slice(0, 10);
  }
  return undefined;
}

export function parseDaySummary(
  summary: Record<string, unknown> | null | undefined,
): ParsedSummary {
  if (!summary) return { priorities: [] };
  return {
    visits: pickNum(summary, ["visits", "visitsCount", "totalVisits"]),
    closes: pickNum(summary, ["closes", "closed", "wins", "dealsClosed"]),
    newProspects: pickNum(summary, ["newProspects", "prospectsAdded"]),
    callbacks: pickNum(summary, [
      "callbacks",
      "callbacksScheduled",
      "callbacksSet",
    ]),
    outcomes: pickNumMap(summary, ["outcomes", "outcomeCounts", "byOutcome"]),
    priorities:
      pickStrList(summary, [
        "priorities",
        "tomorrow",
        "tomorrowPriorities",
        "nextActions",
        "followUps",
        "focus",
      ]) ?? [],
    date: pickDate(summary),
  };
}

// ---------------------------------------------------------------------------
// Card construction (pure)
// ---------------------------------------------------------------------------

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

function humanizeOutcome(s: string): string {
  return s.replace(/[_-]+/g, " ").trim();
}

/** Grounded one-line recap built only from counts/outcomes present. */
function buildRecap(p: ParsedSummary): string {
  const parts: string[] = [];
  if (p.visits != null) parts.push(plural(p.visits, "visit"));
  if (p.closes != null) parts.push(plural(p.closes, "close"));
  if (p.newProspects != null)
    parts.push(plural(p.newProspects, "new prospect"));
  if (p.callbacks != null) parts.push(`${plural(p.callbacks, "callback")} set`);
  if (parts.length > 0) return parts.join(", ");

  if (p.outcomes) {
    const top = Object.entries(p.outcomes)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([name, n]) => `${humanizeOutcome(name)} ×${n}`);
    if (top.length > 0) return top.join(", ");
  }
  return "";
}

/**
 * Priorities for tomorrow. Prefer the summary's explicit list; otherwise derive
 * only from concrete signals (interested prospects, scheduled callbacks). Never
 * invents a named action.
 */
function buildPriorities(p: ParsedSummary, max: number): string[] {
  if (p.priorities.length > 0) return p.priorities.slice(0, max);

  const derived: string[] = [];
  const interested = p.outcomes?.interested ?? p.outcomes?.Interested;
  if (typeof interested === "number" && interested > 0) {
    derived.push(
      `Follow up with ${plural(interested, "interested prospect")} from today.`,
    );
  }
  if (p.callbacks != null && p.callbacks > 0) {
    derived.push(
      `${plural(p.callbacks, "callback")} lined up — plan your route.`,
    );
  }
  return derived.slice(0, max);
}

const TITLE_MAX = 200;
const BODY_MAX = 5000;

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * Build the debrief card, or null when the summary carries nothing worth a card
 * (no recap signal and no priorities) — the caller treats null as a skip.
 */
export function buildDebrief(opts: {
  repId?: string;
  daySummary: Record<string, unknown> | null | undefined;
  /** When the day.ended event occurred (date fallback). */
  occurredAt: Date;
  now: Date;
  cfg: DebriefConfig;
  agentRunId?: number;
}): SuggestionPayload | null {
  const parsed = parseDaySummary(opts.daySummary);
  const recap = buildRecap(parsed);
  const priorities = buildPriorities(parsed, opts.cfg.maxPriorities);

  if (recap === "" && priorities.length === 0) return null;

  const date = parsed.date ?? localDateInZone(opts.occurredAt, opts.cfg.timeZone);

  const title = truncate(
    recap ? `Day wrap: ${recap}` : `Day wrap — ${date}`,
    TITLE_MAX,
  );

  const lines: string[] = [];
  lines.push(recap ? `Today: ${recap}.` : "Here's your day wrap.");
  if (priorities.length > 0) {
    lines.push("");
    lines.push("Tomorrow's focus:");
    for (const pr of priorities) lines.push(`- ${pr}`);
  }
  const body = truncate(lines.join("\n"), BODY_MAX);

  const data: Record<string, unknown> = { date, priorities };
  if (parsed.visits != null) data.visits = parsed.visits;
  if (parsed.closes != null) data.closes = parsed.closes;
  if (parsed.newProspects != null) data.newProspects = parsed.newProspects;
  if (parsed.callbacks != null) data.callbacks = parsed.callbacks;
  if (parsed.outcomes) data.outcomes = parsed.outcomes;

  return {
    type: "debrief",
    title,
    body,
    priority: "normal",
    repId: opts.repId,
    dedupeKey: `hermes:debrief:${opts.repId ?? "rep"}:${date}`,
    expiresAt: endOfNextDayIso(opts.now, opts.cfg.timeZone),
    agentRunId: opts.agentRunId,
    data,
  };
}

/**
 * ISO timestamp (with offset) for the end of the *next* local day in `tz`.
 * Uses the zone offset at `now`; the sub-second/DST drift is immaterial for an
 * expiry boundary (matches the approximation in proximity.endOfWindowIso).
 */
export function endOfNextDayIso(now: Date, tz: string): string {
  const today = localDateInZone(now, tz); // YYYY-MM-DD
  const [y, m, d] = today.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)); // rolls month/year over
  const ny = next.getUTCFullYear();
  const nm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const nd = String(next.getUTCDate()).padStart(2, "0");
  const offsetMin = zoneOffsetMinutes(now, tz);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const oh = String(Math.floor(abs / 60)).padStart(2, "0");
  const om = String(abs % 60).padStart(2, "0");
  return `${ny}-${nm}-${nd}T23:59:59${sign}${oh}:${om}`;
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

function isStale(occurredAt: Date, now: Date, cfg: DebriefConfig): boolean {
  const t = occurredAt.getTime();
  if (Number.isNaN(t)) return false; // unparseable timestamp: don't drop
  return now.getTime() - t > cfg.maxStaleHours * 3600_000;
}

export async function runDebrief(
  opts: RunDebriefOptions,
): Promise<RunDebriefResult> {
  const cfg: DebriefConfig = { ...DEFAULT_DEBRIEF_CONFIG, ...opts.config };
  const now = opts.now ?? new Date();

  await reportRun(opts.client, opts.agentRunId, { status: "running" });

  try {
    const result = await execute(opts, cfg, now);
    await reportRun(opts.client, opts.agentRunId, {
      status: result.posted > 0 ? "completed" : "skipped",
      output: {
        posted: result.posted,
        skipped: result.skipped,
        date: result.date,
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
  opts: RunDebriefOptions,
  cfg: DebriefConfig,
  now: Date,
): Promise<RunDebriefResult> {
  const events = await opts.client.getEvents({
    type: "day.ended",
    limit: 1,
    repId: opts.repId,
  });
  const ev = events[0];
  if (!ev) return { posted: 0, skipped: "no_day_ended" };

  const occurredAt = new Date(ev.createdAt);
  if (isStale(occurredAt, now, cfg)) {
    return { posted: 0, skipped: "stale_day_ended" };
  }

  const card = buildDebrief({
    repId: opts.repId,
    daySummary: ev.payload,
    occurredAt,
    now,
    cfg,
    agentRunId: opts.agentRunId,
  });
  if (!card) return { posted: 0, skipped: "empty_day_summary" };

  await opts.client.postSuggestion(card);
  return {
    posted: 1,
    date: (card.data?.date as string | undefined) ?? undefined,
    dedupeKey: card.dedupeKey,
  };
}
