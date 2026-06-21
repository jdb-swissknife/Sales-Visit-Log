import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, businessesTable } from "@workspace/db";
import {
  scoreHvacTarget,
  summarizeHvacClusters,
  type HvacPriorityGrade,
  type HvacScoreResult,
} from "../lib/hvac-scoring";

const router: IRouter = Router();

function priorityFromGrade(grade: HvacPriorityGrade): "high" | "medium" | "low" {
  if (grade === "A" || grade === "B") return "high";
  if (grade === "C") return "medium";
  return "low";
}

function targetFromBusiness(b: typeof businessesTable.$inferSelect) {
  return {
    address: b.address,
    zip: zipFromAddress(b.address),
    street: b.address,
    subdivision: b.subdivision,
    neighborhood: b.neighborhood,
    yearBuilt: b.yearBuilt,
    lastHvacPermitYear: b.lastHvacPermitYear,
    lastMajorRenovationYear: b.lastMajorRenovationYear,
    ownerOccupied: b.ownerOccupied,
    livingAreaSqft: b.livingAreaSqft,
    amiBand: b.amiBand,
    utilityProvider: b.utilityProvider,
  };
}

function zipFromAddress(address?: string | null): string | null {
  if (!address) return null;
  const match = address.match(/\b\d{5}(?:-\d{4})?\b/);
  return match?.[0]?.slice(0, 5) ?? null;
}

function hydrateScore(b: typeof businessesTable.$inferSelect): HvacScoreResult | null {
  if (b.replacementScore == null || !b.priorityGrade || !b.clusterKey) return null;
  const grade = ["A", "B", "C", "D"].includes(b.priorityGrade) ? (b.priorityGrade as HvacPriorityGrade) : "D";
  return {
    ...targetFromBusiness(b),
    replacementScore: b.replacementScore,
    priorityGrade: grade,
    scoreReasons: (b.scoreReasons ?? "").split("; ").filter(Boolean),
    recommendedPitch: b.recommendedPitch ?? "",
    clusterKey: b.clusterKey,
  };
}

router.post("/hvac/score", async (req, res): Promise<void> => {
  const scored = scoreHvacTarget(req.body ?? {});
  res.json(scored);
});

router.post("/hvac/rescore", async (_req, res): Promise<void> => {
  const rows = await db.select().from(businessesTable).where(sql`${businessesTable.sector} = 'residential_hvac' OR ${businessesTable.yearBuilt} IS NOT NULL`);
  let updated = 0;

  for (const row of rows) {
    const scored = scoreHvacTarget(targetFromBusiness(row));
    await db
      .update(businessesTable)
      .set({
        replacementScore: scored.replacementScore,
        priorityGrade: scored.priorityGrade,
        scoreReasons: scored.scoreReasons.join("; "),
        recommendedPitch: scored.recommendedPitch,
        clusterKey: scored.clusterKey,
        priority: priorityFromGrade(scored.priorityGrade),
        buildingGroup: row.buildingGroup ?? scored.clusterKey,
        updatedAt: new Date(),
      })
      .where(eq(businessesTable.id, row.id));
    updated += 1;
  }

  res.json({ updated });
});

router.get("/hvac/clusters", async (_req, res): Promise<void> => {
  const rows = await db.select().from(businessesTable).where(sql`${businessesTable.sector} = 'residential_hvac' OR ${businessesTable.replacementScore} IS NOT NULL`);
  const scored = rows
    .map((row) => hydrateScore(row) ?? scoreHvacTarget(targetFromBusiness(row)))
    .filter((row) => row.replacementScore > 0);
  res.json(summarizeHvacClusters(scored));
});

export default router;
