import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import webhooksInboundRouter from "./routes/webhooks-inbound";
import { logger } from "./lib/logger";
import { sessionContext } from "./middlewares/local-auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
const allowedOrigins = new Set(["https://svl.trustmvs.com", "http://localhost:8097", "http://127.0.0.1:8097"]);
app.use(cors({ origin: (origin, cb) => cb(null, !origin || allowedOrigins.has(origin)), credentials: true }));
app.use((req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const origin = req.get("origin");
  if (req.path.startsWith("/api") && !["GET", "HEAD", "OPTIONS"].includes(req.method) &&
      ((origin && !allowedOrigins.has(origin)) || req.get("sec-fetch-site") === "cross-site")) {
    res.status(403).json({ error: "Cross-site requests are not allowed" });
    return;
  }
  next();
});
app.use(sessionContext);

// Mounted before express.json() — HMAC verification needs the raw body.
app.use(webhooksInboundRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
