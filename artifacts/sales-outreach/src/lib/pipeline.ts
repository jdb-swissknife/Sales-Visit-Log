/**
 * Shared pipeline vocabulary for the UI. Mirrors api-server/src/lib/pipeline.ts.
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

export const STAGE_LABELS: Record<PipelineStage, string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  follow_up: "Follow up",
  proposal_sent: "Proposal sent",
  converted: "Won",
  not_interested: "Lost",
};

/** Badge classes (light + dark). */
export const STAGE_BADGE: Record<PipelineStage, string> = {
  not_contacted: "bg-muted text-muted-foreground",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  follow_up: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  proposal_sent: "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-300",
  converted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  not_interested: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

/** Solid fill classes for funnel bars. */
export const STAGE_FILL: Record<PipelineStage, string> = {
  not_contacted: "bg-slate-400",
  contacted: "bg-blue-500",
  follow_up: "bg-amber-500",
  proposal_sent: "bg-violet-500",
  converted: "bg-green-500",
  not_interested: "bg-red-500",
};

/** Hex colours for the MapLibre markers. */
export const STAGE_HEX: Record<PipelineStage, string> = {
  not_contacted: "#64748b",
  contacted: "#3b82f6",
  follow_up: "#f59e0b",
  proposal_sent: "#8b5cf6",
  converted: "#22c55e",
  not_interested: "#ef4444",
};

export function isPipelineStage(value: unknown): value is PipelineStage {
  return typeof value === "string" && (PIPELINE_STAGES as readonly string[]).includes(value);
}

export function stageLabel(status: string): string {
  return isPipelineStage(status) ? STAGE_LABELS[status] : status.replace(/_/g, " ");
}

export function stageBadge(status: string): string {
  return isPipelineStage(status) ? STAGE_BADGE[status] : STAGE_BADGE.not_contacted;
}

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export function formatMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return money.format(value);
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${Math.round(value * 100)}%`;
}
