import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
} from "./middlewares/clerkProxyMiddleware";
import { requestIdMiddleware } from "./middlewares/requestId";
import { errorHandlerMiddleware } from "./middlewares/errorHandler";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Request id MUST come before pino-http so the logger picks it up via
// `req.id`, and before any handler that might throw so the error
// boundary can include it on the row + response header.
app.use(requestIdMiddleware());

app.use(
  pinoHttp({
    logger,
    // Reuse the id we just minted instead of pino-http's default.
    genReqId: (req) => (req as unknown as { id?: string }).id ?? "",
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

// Clerk proxy must be mounted BEFORE body parsers — the proxy streams
// raw bytes through to Clerk's edge.
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Verifies the Clerk session token (Bearer / cookie) and exposes
// `req.auth` to every downstream handler. resolveCreator() reads it.
app.use(clerkMiddleware());

app.use("/api", router);

// Error boundary — must be the LAST middleware so it catches
// everything thrown above. Persists each error to `error_events` and
// returns a sanitized JSON body. See middlewares/errorHandler.ts.
app.use(errorHandlerMiddleware());

export default app;
