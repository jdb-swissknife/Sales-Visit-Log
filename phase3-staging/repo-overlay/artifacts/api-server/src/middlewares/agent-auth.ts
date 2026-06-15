/**
 * Agent API authentication (R2).
 *
 * `requireAgentKey` guards every /api/agent/* route (mounted in R3).
 *   - If AGENT_API_KEY is unset → 503 (feature not configured), so the agent
 *     surface is closed-by-default until secrets are set at R5 activation.
 *   - Otherwise require `Authorization: Bearer <AGENT_API_KEY>`, compared in
 *     constant time. 401 on missing/invalid.
 *
 * App-facing routes (suggestions feed, insights read) do NOT use this — they are
 * scoped by the app's own auth, per the plan.
 */
import { timingSafeEqual } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

/** Constant-time string compare that won't leak length via early return timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function extractBearer(header: string | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

export function requireAgentKey(req: Request, res: Response, next: NextFunction): void {
  const configured = process.env.AGENT_API_KEY;
  if (!configured) {
    res.status(503).json({ error: "agent_api_unconfigured", message: "Agent API is not configured." });
    return;
  }

  const token = extractBearer(req.header("authorization"));
  if (!token || !safeEqual(token, configured)) {
    res.status(401).json({ error: "invalid_agent_credentials", message: "Missing or invalid agent API key." });
    return;
  }

  next();
}

export default requireAgentKey;
