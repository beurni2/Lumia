import app from "./app";
import { logger } from "./lib/logger";
import { startNightlyScheduler } from "./lib/nightlyScheduler";

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

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
  // Boot the nightly swarm scheduler — opt-in creators only, dedupe
  // guarded inside the tick. Idempotent: safe even if the module is
  // re-imported under hot reload.
  startNightlyScheduler();
});
