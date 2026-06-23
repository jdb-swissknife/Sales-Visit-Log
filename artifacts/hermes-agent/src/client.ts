/**
 * Thin HTTP client for the Sales-Visit-Log agent API. Every call is
 * Bearer-authenticated; this is the only place Hermes touches the network.
 */
import type { AgentContext, EventItem, SuggestionPayload } from "./types";

export interface HermesClientOptions {
  baseUrl: string;
  apiKey: string;
  /** Injectable for tests. */
  fetchImpl?: typeof fetch;
}

export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "skipped";

export class HermesClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: HermesClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async req<T>(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  getContext(): Promise<AgentContext> {
    return this.req<AgentContext>("GET", "/api/agent/context");
  }

  getEvents(params: { type?: string; limit?: number; since?: string; repId?: string } = {}): Promise<
    EventItem[]
  > {
    const q = new URLSearchParams();
    if (params.type) q.set("type", params.type);
    // repId scopes the feed to a single rep server-side (EventItem carries no
    // rep field, so we cannot re-verify client-side; we rely on the server).
    if (params.repId) q.set("repId", params.repId);
    if (params.limit != null) q.set("limit", String(params.limit));
    if (params.since) q.set("since", params.since);
    const qs = q.toString();
    return this.req<EventItem[]>("GET", `/api/agent/events${qs ? `?${qs}` : ""}`);
  }

  postSuggestion(body: SuggestionPayload): Promise<{ id: number }> {
    return this.req<{ id: number }>("POST", "/api/agent/suggestions", body);
  }

  /**
   * Open a new agent run (POST /agent/runs) and return its id. Used by the
   * harness to create a tracked run before invoking a behavior, which then
   * walks the run's lifecycle via patchRun.
   */
  async createRun(body: {
    eventType: string;
    eventId?: string;
    externalRunId?: string;
    correlationId?: string;
    status?: "queued" | "running";
  }): Promise<{ id: number }> {
    return this.req<{ id: number }>("POST", "/api/agent/runs", body);
  }

  patchRun(
    id: number,
    body: { status: RunStatus; output?: unknown; error?: string },
  ): Promise<unknown> {
    return this.req("PATCH", `/api/agent/runs/${id}`, body);
  }

  /**
   * Upsert a rep-level insight (POST /agent/rep-insights). The server upserts
   * by (repId, type), so repeated calls for the same pattern refresh the row
   * rather than stacking.
   */
  postRepInsight(body: {
    repId: string;
    type: string;
    summary: string;
    score?: number;
    periodStart?: string;
    periodEnd?: string;
    data?: Record<string, unknown>;
    agentRunId?: number;
  }): Promise<unknown> {
    return this.req("POST", "/api/agent/rep-insights", body);
  }
}
