/**
 * Thin HTTP client for the SVL API server. Reuses the same Bearer auth pattern
 * as hermes-agent's client. Only the endpoints the sync needs: context
 * (businesses), create visit, create media, and log event.
 */
import type { BusinessCtx } from "./types";

export interface SvlClientOptions {
  baseUrl: string;
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export interface SvlBusiness {
  id: number;
  name: string;
  sector?: string;
}

export interface CreatedVisit {
  id: number;
  businessId: number;
}

export class SvlClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SvlClientOptions) {
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
      throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  /** Get all businesses for matching. */
  async getBusinesses(): Promise<SvlBusiness[]> {
    const data = await this.req<BusinessCtx[]>("GET", "/api/businesses");
    return data.map((b) => ({ id: b.id, name: b.name, sector: b.sector ?? undefined }));
  }

  /** Create a visit for a business. Returns the visit id. */
  async createVisit(body: {
    businessId: number;
    repId?: string;
    outcome?: string;
    visitedAt?: string;
  }): Promise<CreatedVisit> {
    return this.req<CreatedVisit>("POST", "/api/visits", body);
  }

  /** Create a media row (voice note) on a visit with pre-transcribed content. */
  async createMedia(body: {
    visitId: number;
    type: string;
    url: string;
    filename: string;
    mimeType?: string;
    sizeBytes?: number;
    transcriptionStatus?: string;
    transcript?: string;
    aiStructured?: Record<string, unknown>;
  }): Promise<{ id: number }> {
    return this.req<{ id: number }>("POST", "/api/media", body);
  }

  /** Log an event (e.g. voice_log.imported). */
  async logEvent(body: {
    type: string;
    entityType?: string;
    entityId?: number;
    businessId?: number;
    visitId?: number;
    repId?: string;
    payload?: Record<string, unknown>;
  }): Promise<void> {
    try {
      await this.req<unknown>("POST", "/api/agent/events", body);
    } catch {
      // advisory
    }
  }
}
