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
  repId?: string | null;
  payload?: Record<string, unknown> | null;
  source: string;
  createdAt: string;
}

export type SuggestionPriority = "low" | "normal" | "high" | "urgent";

/** Card types the server accepts (see api-server suggestions route enum). */
export type SuggestionType =
  | "callback_reminder"
  | "nearby_prospect"
  | "coaching"
  | "debrief"
  | "other";

/**
 * A suggestion card payload. `type`-specific behaviors fill the optional fields
 * they need: nearby_prospect always sets businessId/actionUrl/priorityScore;
 * debrief is rep-level and omits them. Only the fields common to every card are
 * required here.
 */
export interface SuggestionPayload {
  type: SuggestionType;
  title: string;
  body: string;
  priority: SuggestionPriority;
  dedupeKey: string;
  expiresAt: string;
  /** Every card carries a (possibly empty) free-form context bag. */
  data: Record<string, unknown>;
  businessId?: number;
  repId?: string;
  priorityScore?: number;
  actionLabel?: string;
  actionUrl?: string;
  agentRunId?: number;
}
