import app from "./app";
import { runMigrations } from "./db/migrate";
import {
  startCleanupSweeper,
  stopCleanupSweeper,
} from "./lib/cleanupSweeper";
import { startJobWorker, stopJobWorker } from "./lib/jobQueue";
import { logger } from "./lib/logger";
import {
  startNightlyScheduler,
  stopNightlyScheduler,
} from "./lib/nightlyScheduler";
import { registerSwarmJobHandlers } from "./lib/swarmJobs";

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

async function boot() {
  // Apply any pending schema migrations BEFORE accepting traffic so
  // route handlers never see a half-migrated schema. Advisory-lock
  // ensures concurrent boots serialize safely.
  await runMigrations();

  // Register every job-type handler before the worker starts polling
  // so the very first claim has somewhere to dispatch.
  registerSwarmJobHandlers();

  const server = app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }
    logger.info({ port }, "Server listening");

    // Background workers boot AFTER listen so health checks pass
    // immediately and any orphan-recovery sweeps don't block startup.
    void startJobWorker();
    startNightlyScheduler();
    startCleanupSweeper();
  });

  // Graceful shutdown: stop accepting new connections, stop the
  // scheduler, and drain in-flight job handlers before exiting. This
  // prevents the container from leaving 'running' job rows behind
  // that have to wait for lease expiry to be reclaimed.
  let shuttingDown = false;
  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, "shutdown initiated");
    stopNightlyScheduler();
    stopCleanupSweeper();
    server.close(() => logger.info("http server closed"));
    try {
      await stopJobWorker(25_000);
    } catch (err) {
      logger.error({ err }, "stopJobWorker failed");
    }
    // Give pino a beat to flush.
    setTimeout(() => process.exit(0), 200);
  }
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

boot().catch((err) => {
  logger.error({ err }, "Boot failure");
  // Give pino a beat to flush before exit.
  setTimeout(() => process.exit(1), 200);
});
