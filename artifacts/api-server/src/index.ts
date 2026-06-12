import app from "./app";
import { logger } from "./lib/logger";
import { seedBusinesses } from "@workspace/db/seed";
import { backfillMissingGeocodes } from "./lib/geocode";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

seedBusinesses((msg) => logger.info(msg))
  .then(() => backfillMissingGeocodes())
  .catch((err) => {
    logger.error({ err }, "Seed failed");
  });

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});
