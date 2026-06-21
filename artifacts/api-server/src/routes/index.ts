import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import businessesRouter from "./businesses";
import visitsRouter from "./visits";
import notesRouter from "./notes";
import mediaRouter from "./media";
import statsRouter from "./stats";
import routesRouter from "./routes";
import hvacRouter from "./hvac";
import eventsRouter from "./events";
import agentRouter from "./agent";
import suggestionsRouter from "./suggestions";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(businessesRouter);
router.use(visitsRouter);
router.use(notesRouter);
router.use(mediaRouter);
router.use(statsRouter);
router.use(routesRouter);
router.use(hvacRouter);
router.use(eventsRouter);
router.use(agentRouter);
router.use(suggestionsRouter);

export default router;
