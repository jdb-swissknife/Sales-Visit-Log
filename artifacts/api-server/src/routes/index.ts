import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import businessesRouter from "./businesses";
import visitsRouter from "./visits";
import notesRouter from "./notes";
import mediaRouter from "./media";
import statsRouter from "./stats";
import routesRouter from "./routes";
import eventsRouter from "./events";
import agentRouter from "./agent";
import suggestionsRouter from "./suggestions";
import { requireAuth } from "../middlewares/clerk-auth";

const router: IRouter = Router();

// ── Open routes (no auth) ────────────────────────────────────────────────────
router.use(healthRouter);
router.use(storageRouter);

// ── Agent routes (API key auth, applied inside the router) ──────────────────
router.use(agentRouter);

// ── Authenticated app routes (Clerk session required) ───────────────────────
// requireAuth is mounted on the parent router BEFORE the authed sub-routers,
// so it runs for every request that reaches them.
router.use(requireAuth);
router.use(businessesRouter);
router.use(visitsRouter);
router.use(notesRouter);
router.use(mediaRouter);
router.use(statsRouter);
router.use(routesRouter);
router.use(eventsRouter);
router.use(suggestionsRouter);

export default router;
