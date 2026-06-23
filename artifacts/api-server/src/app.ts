import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import webhooksInboundRouter from "./routes/webhooks-inbound";
import { logger } from "./lib/logger";
import { clerkContext } from "./middlewares/clerk-auth";

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
app.use(cors({ origin: true, credentials: true }));

// Clerk context (loose -- parses session if present, does not reject)
app.use(clerkContext);

// Mounted before express.json() — HMAC verification needs the raw body.
app.use(webhooksInboundRouter);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
