import { EventEmitter } from "node:events";
import type { AgentSuggestion } from "@workspace/db";

/**
 * In-process pub/sub for new agent suggestions.
 * POST /api/agent/suggestions publishes; GET /api/suggestions/stream (SSE) subscribes.
 * Single-instance only — fine for the Replit deployment.
 */
class SuggestionBus extends EventEmitter {
  publish(suggestion: AgentSuggestion): void {
    this.emit("suggestion", suggestion);
  }

  subscribe(listener: (s: AgentSuggestion) => void): () => void {
    this.on("suggestion", listener);
    return () => this.off("suggestion", listener);
  }
}

export const suggestionBus = new SuggestionBus();
suggestionBus.setMaxListeners(100);
