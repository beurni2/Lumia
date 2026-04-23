/**
 * Postgres client — single shared pool for the api-server process.
 *
 * Drizzle wraps node-postgres so route handlers can build typed queries
 * against the schema in ./schema.ts.
 */

import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "./schema";

const url = process.env["DATABASE_URL"];
if (!url) {
  throw new Error(
    "DATABASE_URL is not set. Provision the database before starting the API server.",
  );
}

const pool = new pg.Pool({ connectionString: url, max: 8 });

export const db = drizzle(pool, { schema });
export { schema };
