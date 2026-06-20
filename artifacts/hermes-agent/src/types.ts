/**
 * Shapes Hermes consumes from the Sales-Visit-Log agent API. These mirror the
 * server's `GET /api/agent/context` and `GET /api/agent/events` responses; we
 * keep our own copy so the agent stays a decoupled HTTP client.
 */

export type Priority = "low" | "medium" | "high";

export interface BusinessCtx {
  id: number;
  name: string;
  address: string | null;
  sector: string | null;
  status: string;
  priority: string;
  latitude: number | null;
  longitude: number | null;
}

export interface AgentContext {
  businesses: BusinessCtx[];
  upcomingCallbacks: unknown[];
  generatedAt: string;
}

export interface EventItem {
  id: number;
  type: string;
  entityType?: string;
  entityId?: number;
  businessId?: number;
  visitId?: number;
  payload?: Record<string, unknown>;
  source: string;
  createdAt: string;
}

export type SuggestionPriority = "low" | "normal" | "high" | "urgent";

export interface SuggestionPayload {
  type: "nearby_prospect";
  title: string;
  body: string;
  priority: SuggestionPriority;
  businessId: number;
  repId?: string;
  priorityScore: number;
  dedupeKey: string;
  actionLabel: string;
  actionUrl: string;
  expiresAt: string;
  agentRunId?: number;
  data: Record<string, unknown>;
}
