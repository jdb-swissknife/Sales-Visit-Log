/**
 * Pipeline rules — pure functions, no I/O.
 *
 * Stage order:  not_contacted → contacted → follow_up → proposal_sent → converted
 *                                                                     ↘ not_interested
 *
 * Two invariants every caller relies on:
 *   1. Logging a visit never DEMOTES a prospect. A won or lost deal stays
 *      won or lost; a prospect with a proposal out stays at proposal_sent.
 *   2. Terminal stages (converted / not_interested) stamp `closedAt`.
 */

export const PIPELINE_STAGES = [
  "not_contacted",
  "contacted",
  "follow_up",
  "proposal_sent",
  "converted",
  "not_interested",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const OPEN_STAGES: readonly PipelineStage[] = ["not_contacted", "contacted", "follow_up", "proposal_sent"];
export const TERMINAL_STAGES: readonly PipelineStage[] = ["converted", "not_interested"];

/** Rank used for "never demote" comparisons. Terminal stages rank highest. */
const STAGE_RANK: Record<PipelineStage, number> = {
  not_contacted: 0,
  contacted: 1,
  follow_up: 2,
  proposal_sent: 3,
  converted: 4,
  not_interested: 4,
};

/**
 * Rough close probability per stage, used for the weighted pipeline value.
 * Deliberately conservative for door-to-door; tune once there's real data.
 */
export const STAGE_WIN_PROBABILITY: Record<PipelineStage, number> = {
  not_contacted: 0,
  contacted: 0.1,
  follow_up: 0.25,
  proposal_sent: 0.5,
  converted: 1,
  not_interested: 0,
};

export function isTerminalStage(stage: string): boolean {
  return (TERMINAL_STAGES as readonly string[]).includes(stage);
}

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && (PIPELINE_STAGES as readonly string[]).includes(value);
}

export type VisitOutcome = "positive" | "neutral" | "negative" | "follow_up_needed";

export interface VisitSignal {
  outcome: VisitOutcome | string;
  nextActionDate?: Date | string | null;
}

/**
 * Given the prospect's current stage and a freshly logged visit, return the
 * stage the prospect should be in afterwards.
 *
 * - Terminal stages are never changed by a visit (use the pipeline endpoint
 *   to reopen a deal deliberately).
 * - A visit that promises a callback (`follow_up_needed` outcome or a
 *   `nextActionDate`) moves the prospect to `follow_up` — unless it is
 *   already further along (proposal_sent), in which case it stays there.
 * - Any other visit ensures the prospect is at least `contacted`.
 */
export function deriveStageAfterVisit(currentStage: string, visit: VisitSignal): PipelineStage {
  const current: PipelineStage = isPipelineStage(currentStage) ? currentStage : "not_contacted";
  if (isTerminalStage(current)) return current;

  const wantsFollowUp = visit.outcome === "follow_up_needed" || visit.nextActionDate != null;
  const candidate: PipelineStage = wantsFollowUp ? "follow_up" : "contacted";

  return STAGE_RANK[candidate] > STAGE_RANK[current] ? candidate : current;
}

export interface StageTransition {
  status: PipelineStage;
  stageChangedAt: Date;
  closedAt: Date | null;
}

/**
 * Field updates to apply when a prospect moves from `from` to `to`.
 * Returns null when nothing changes.
 */
export function stageTransition(from: string, to: PipelineStage, now: Date = new Date()): StageTransition | null {
  if (from === to) return null;
  return {
    status: to,
    stageChangedAt: now,
    closedAt: isTerminalStage(to) ? now : null,
  };
}

/** Whole days between two instants, floored at 0. */
export function daysBetween(from: Date | string | null | undefined, to: Date = new Date()): number | null {
  if (from == null) return null;
  const f = typeof from === "string" ? new Date(from) : from;
  if (Number.isNaN(f.getTime())) return null;
  return Math.max(0, Math.floor((to.getTime() - f.getTime()) / 86_400_000));
}

export type FollowUpBucket = "overdue" | "today" | "upcoming" | "stale";

export interface BucketInput {
  /** Promised next-action date from the latest visit, if any */
  dueAt: Date | string | null | undefined;
  /** When the prospect was last visited */
  lastVisitAt: Date | string | null | undefined;
  staleDays: number;
  now?: Date;
  /** Upper bound (days ahead) for the `upcoming` bucket */
  upcomingWindowDays?: number;
}

/** Local-day boundaries for `now`. */
function dayBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start, end };
}

/**
 * Classify an open prospect into a follow-up bucket, or null if it needs
 * nothing right now.
 *
 *   overdue  — promised date is before today
 *   today    — promised date is today
 *   upcoming — promised date within the next `upcomingWindowDays` (default 7)
 *   stale    — no promised date (or one far out) but last visit ≥ staleDays ago
 */
export function classifyFollowUp(input: BucketInput): FollowUpBucket | null {
  const now = input.now ?? new Date();
  const window = input.upcomingWindowDays ?? 7;
  const { start, end } = dayBounds(now);

  if (input.dueAt != null) {
    const due = typeof input.dueAt === "string" ? new Date(input.dueAt) : input.dueAt;
    if (!Number.isNaN(due.getTime())) {
      if (due < start) return "overdue";
      if (due < end) return "today";
      const horizon = new Date(start);
      horizon.setDate(horizon.getDate() + window + 1);
      if (due < horizon) return "upcoming";
      // Far-future promise: not stale, the rep already has a plan.
      return null;
    }
  }

  const since = daysBetween(input.lastVisitAt, now);
  if (since != null && since >= input.staleDays) return "stale";
  return null;
}
