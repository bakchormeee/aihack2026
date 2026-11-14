// Test replacement for `@/db` (aliased in vitest.config.mts). Each test file
// gets its own empty in-memory Postgres with the real migrations applied, so
// integration tests need no external database and cannot affect each other.

import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import type { Db } from "./index";
import * as schema from "./schema";

const pglite = drizzle(new PGlite(), { schema });
await migrate(pglite, { migrationsFolder: "src/db/migrations" });

export const db = pglite as unknown as Db;
