/**
 * App-facing insights read API (R3).
 *
 *   GET /api/insights/prospect?businessId=<int>   active insights for a prospect
 *   GET /api/insights/rep?repId=<int>             active insights for a rep
 *
 * App-facing → NOT behind requireAgentKey. Read-only; Hermes writes via the agent API.
 * Returns only `active` insights by default (pass ?status=all to include superseded/dismissed).
 *
 * ── ASSUMPTIONS to confirm at activation ─────────────────────────────────────
 *  A1. `db` and `insightsTable` exported from "@workspace/db".
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { and, desc, eq } from "drizzle-orm";
import { db, insightsTable } from "@workspace/db";

const router: IRouter = Router();

const prospectQuery = z.object({
  businessId: z.coerce.number().int(),
  status: z.enum(["active", "all"]).default("active"),
});

const repQuery = z.object({
  repId: z.coerce.number().int(),
  status: z.enum(["active", "all"]).default("active"),
});

// GET /api/insights/prospect?businessId=
router.get("/prospect", async (req, res) => {
  const q = prospectQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "invalid_query", message: q.error.issues[0]?.message });
    return;
  }
  const { businessId, status } = q.data;

  const conditions = [eq(insightsTable.businessId, businessId)];
  if (status === "active") conditions.push(eq(insightsTable.status, "active"));

  const rows = await db
    .select()
    .from(insightsTable)
    .where(and(...conditions))
    .orderBy(desc(insightsTable.lastConfirmedAt));

  res.json({ insights: rows });
});

// GET /api/insights/rep?repId=
router.get("/rep", async (req, res) => {
  const q = repQuery.safeParse(req.query);
  if (!q.success) {
    res.status(400).json({ error: "invalid_query", message: q.error.issues[0]?.message });
    return;
  }
  const { repId, status } = q.data;

  const conditions = [eq(insightsTable.repId, repId)];
  if (status === "active") conditions.push(eq(insightsTable.status, "active"));

  const rows = await db
    .select()
    .from(insightsTable)
    .where(and(...conditions))
    .orderBy(desc(insightsTable.lastConfirmedAt));

  res.json({ insights: rows });
});

export default router;
