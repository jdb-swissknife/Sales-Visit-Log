/**
 * In-memory pub/sub for the suggestions SSE stream (R2).
 *
 * Single-process fan-out: route handlers that mutate suggestions (the R3
 * `POST /api/agent/suggestions` upsert and `PATCH /api/suggestions/:id`) call
 * `suggestionBus.publish(...)`; the `GET /api/suggestions/stream` SSE handler
 * subscribes and writes each event to the client.
 *
 * Deliberately in-memory (decision: single Replit instance, no external broker).
 * If the app is ever scaled horizontally this becomes a Redis pub/sub swap, but
 * the publish/subscribe surface here stays the same.
 */
import { EventEmitter } from "node:events";

const CHANNEL = "suggestion";

/** What flows over the bus to each connected SSE client. */
export interface SuggestionBusEvent {
  /** "created" on upsert insert, "updated" on status change / upsert update. */
  type: "created" | "updated";
  /** The suggestion row (shape owned by the suggestions route / schema). */
  suggestion: unknown;
}

export type SuggestionListener = (event: SuggestionBusEvent) => void;

class SuggestionBus {
  private readonly emitter = new EventEmitter();

  constructor() {
    // One listener per open SSE connection — don't cap it.
    this.emitter.setMaxListeners(0);
  }

  /** Broadcast to all connected SSE clients. */
  publish(event: SuggestionBusEvent): void {
    this.emitter.emit(CHANNEL, event);
  }

  /** Subscribe a client; returns an unsubscribe fn to call on connection close. */
  subscribe(listener: SuggestionListener): () => void {
    this.emitter.on(CHANNEL, listener);
    return () => this.emitter.off(CHANNEL, listener);
  }

  /** Number of currently connected SSE clients (useful for /healthz or debugging). */
  subscriberCount(): number {
    return this.emitter.listenerCount(CHANNEL);
  }
}

/** Process-wide singleton. */
export const suggestionBus = new SuggestionBus();
