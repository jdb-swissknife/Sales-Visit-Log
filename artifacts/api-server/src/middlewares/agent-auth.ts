import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

let warned = false;

/**
 * API-key auth for agent-facing routes (/api/agent/*).
 *
 * Hermes must send:  Authorization: Bearer <AGENT_API_KEY>
 * (also accepts the x-api-key header).
 *
 * If AGENT_API_KEY is not configured, ALL agent routes return 503 —
 * the agent surface stays closed until a key is explicitly set.
 */
export function requireAgentKey(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.AGENT_API_KEY;

  if (!configured) {
    if (!warned) {
      warned = true;
      logger.warn("AGENT_API_KEY not set — /api/agent/* routes are disabled");
    }
    res.status(503).json({ error: "Agent API not configured (AGENT_API_KEY missing)" });
    return;
  }

  const header = req.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  const provided = bearer ?? req.get("x-api-key");

  if (!provided || provided !== configured) {
    res.status(401).json({ error: "Invalid or missing API key" });
    return;
  }

  next();
}
