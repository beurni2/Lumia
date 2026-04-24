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
import { rateLimit } from "./middlewares/rateLimit";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// trust proxy: explicit `false` so req.ip uses the immediate socket
// address rather than honoring inbound X-Forwarded-For. This is the
// correct setting today (the rate limiter needs to see real client
// addresses, not a spoofable header). When we move behind a managed
// proxy or load balancer we'll need to set this to the appropriate
// hop count or trusted CIDR — see middlewares/rateLimit.ts header
// comment for the migration note.
app.set("trust proxy", false);

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

// Webhook receivers MUST see the raw request body to verify the
// provider's HMAC signature — once express.json() has parsed and
// re-stringified the bytes, the signature is dead. So mount a raw
// body parser scoped to /api/webhooks/* BEFORE the global JSON
// parser. The `type: '*/*'` is intentional: providers occasionally
// send unusual content-types and we want the bytes either way.
app.use(
  "/api/webhooks",
  express.raw({ type: "*/*", limit: "1mb" }),
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Verifies the Clerk session token (Bearer / cookie) and exposes
// `req.auth` to every downstream handler. resolveCreator() reads it.
app.use(clerkMiddleware());

// Coarse abuse guard for the API surface. 600 hits / minute / IP is
// generous enough that a real interactive client never trips it but
// stops a runaway script from hammering the server. Tighter caps for
// individual sensitive routes are applied inside their routers.
//
// Webhook receivers are excluded from this bucket — they get their
// own dedicated limiter inside the webhooks router. Otherwise a
// flood of bogus signed-webhook attempts from one IP could starve
// legitimate API calls from the same address (e.g. shared office
// NAT) of their bucket.
app.use(
  "/api",
  rateLimit({
    max: 600,
    windowMs: 60_000,
    prefix: "api",
    skip: (req) => req.path.startsWith("/webhooks"),
  }),
);

app.use("/api", router);

// Error boundary — must be the LAST middleware so it catches
// everything thrown above. Persists each error to `error_events` and
// returns a sanitized JSON body. See middlewares/errorHandler.ts.
app.use(errorHandlerMiddleware());

export default app;
