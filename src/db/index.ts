// The application database client. Always import it as `@/db`.
//
// Under Vitest, `@/db` is aliased to ./test-db.ts (see vitest.config.mts),
// which is an in-memory database with the real migrations applied. Nothing
// test-related is in this file, so none of it reaches the production bundle.

import { drizzle } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";

import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;

const globalForDb = globalThis as { __postgresClient?: postgres.Sql };

function createClient(): postgres.Sql {
  // No connection is opened until the first query, so a missing URL does not
  // break `next build`; it fails at the first query with a clear message.
  const url = process.env.DATABASE_URL ?? "postgres://DATABASE_URL-is-not-set.invalid/db";
  // `prepare: false` is required by connection poolers such as Neon's.
  return postgres(url, { prepare: false, max: 5 });
}

// Reuse one client across hot reloads in development.
const client = globalForDb.__postgresClient ?? createClient();
if (process.env.NODE_ENV !== "production") globalForDb.__postgresClient = client;

export const db: Db = drizzle(client, { schema });
