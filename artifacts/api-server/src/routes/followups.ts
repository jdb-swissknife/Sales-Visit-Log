import { Router, type IRouter } from "express";
import { ListFollowUpsQueryParams, ListFollowUpsResponse } from "@workspace/api-zod";
import { canSeeAllReps } from "../middlewares/clerk-auth";
import { buildFollowUpQueue } from "../lib/followups";

const router: IRouter = Router();

/**
 * GET /followups — the rep's working queue for the day.
 * Reps see prospects whose latest visit is theirs; leaders see the team's.
 */
router.get("/followups", async (req, res): Promise<void> => {
  const query = ListFollowUpsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }
  const staleDays = Math.min(Math.max(Math.trunc(query.data.staleDays), 1), 365);
  const repId = !canSeeAllReps(req.userRole) && req.userId ? req.userId : undefined;
  const queue = await buildFollowUpQueue({ repId, staleDays });
  res.json(ListFollowUpsResponse.parse(queue));
});

export default router;
