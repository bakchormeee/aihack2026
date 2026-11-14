import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

// Migration A (0001) adds the new error types and the mistakes column; migration
// B (0002) converts the marks made on the old 0-100 scale and adds the 0-5 check.
// The test applies A, inserts old-style marks, applies B, and looks at the result.
// It runs on an in-memory database only.

const dir = path.join(process.cwd(), "src/db/migrations");
const files = readdirSync(dir)
  .filter((name) => name.endsWith(".sql"))
  .sort();

async function applyMigration(db: PGlite, file: string) {
  const statements = readFileSync(path.join(dir, file), "utf8")
    .split("--> statement-breakpoint")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const statement of statements) await db.exec(statement);
}

async function databaseBeforeConversion() {
  const db = new PGlite();
  for (const file of files.slice(0, 2)) await applyMigration(db, file); // 0000 and 0001
  await db.exec(`
    insert into "user" (id, email) values ('u1', 'm@test.local');
    insert into course (id, user_id, name) values ('c1', 'u1', 'C');
    insert into sheet (id, course_id, title) values ('s1', 'c1', 'S');
    insert into question (id, course_id, sheet_id, position, label, body, expected_minutes)
      values ('q1', 'c1', 's1', 1, '1', 'Q', 5);
  `);
  return db;
}

let counter = 0;
async function insertMark(
  db: PGlite,
  o: {
    score: number;
    outcome: string;
    mistakes?: string | null;
    basis?: string;
    changed?: boolean;
  },
) {
  const n = ++counter;
  await db.exec(`
    insert into attempt (id, user_id, question_id, context) values ('a${n}', 'u1', 'q1', 'sheet');
    insert into mark (id, attempt_id, basis, score, outcome, feedback, overall_feedback, outcome_changed, mistakes)
      values ('m${n}', 'a${n}', '${o.basis ?? "ai"}', ${o.score}, '${o.outcome}', 'fb ${n}', 'ov ${n}',
              ${o.changed ?? false}, ${o.mistakes === undefined || o.mistakes === null ? "null" : `'${o.mistakes}'::jsonb`});
  `);
  return `m${n}`;
}

const markRow = async (db: PGlite, id: string) =>
  (
    await db.query<{ score: number; outcome: string; feedback: string; outcome_changed: boolean }>(
      "select score, outcome, feedback, outcome_changed from mark where id = $1",
      [id],
    )
  ).rows[0];

describe("migration files", () => {
  it("has the three migrations in order: initial, additive A, conversion B", () => {
    expect(files).toHaveLength(3);
    expect(files[2]).toMatch(/^0002_convert_marks_to_five/);
  });
});

describe("migration A (additive)", () => {
  it("adds the two error types and a nullable mistakes column", async () => {
    const db = await databaseBeforeConversion();
    const types = await db.query<{ v: string }>(
      "select enumlabel as v from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'error_type'",
    );
    expect(types.rows.map((r) => r.v)).toEqual(
      expect.arrayContaining(["arithmetic_slip", "notation"]),
    );
    const column = await db.query<{ is_nullable: string }>(
      "select is_nullable from information_schema.columns where table_name = 'mark' and column_name = 'mistakes'",
    );
    expect(column.rows[0].is_nullable).toBe("YES");
  });
});

describe("migration B (conversion)", () => {
  it.each([
    [100, 5, "full"],
    [90, 5, "full"],
    [89, 4, "full"],
    [70, 4, "full"],
    [69, 3, "partial"],
    [50, 3, "partial"],
    [49, 2, "partial"],
    [25, 2, "partial"],
    [24, 1, "stuck"],
    [10, 1, "stuck"],
    [9, 0, "stuck"],
    [0, 0, "stuck"],
  ])("an old mark of %i becomes %i and its outcome is %s", async (old, score, outcome) => {
    const db = await databaseBeforeConversion();
    const id = await insertMark(db, {
      score: old,
      outcome: old >= 90 ? "full" : old >= 25 ? "partial" : "stuck",
    });

    await applyMigration(db, files[2]);

    expect(await markRow(db, id)).toMatchObject({ score, outcome });
  });

  it("converts an old mark of 5 out of 100 to 0, because it has no mistakes list", async () => {
    const db = await databaseBeforeConversion();
    const id = await insertMark(db, { score: 5, outcome: "stuck" });

    await applyMigration(db, files[2]);

    expect((await markRow(db, id)).score).toBe(0);
  });

  it("leaves a mark that already has a mistakes list alone", async () => {
    const db = await databaseBeforeConversion();
    const perfect = await insertMark(db, { score: 5, outcome: "full", mistakes: "[]" });
    const withMistakes = await insertMark(db, {
      score: 3,
      outcome: "partial",
      mistakes: '[{"type":"method","quote":"x","hint":"h","location":{"kind":"text"}}]',
    });

    await applyMigration(db, files[2]);

    expect(await markRow(db, perfect)).toMatchObject({ score: 5, outcome: "full" });
    expect(await markRow(db, withMistakes)).toMatchObject({ score: 3, outcome: "partial" });
  });

  it("changes nothing but the score and outcome of an old mark", async () => {
    const db = await databaseBeforeConversion();
    const id = await insertMark(db, {
      score: 82,
      outcome: "partial",
      basis: "official",
      changed: true,
    });

    await applyMigration(db, files[2]);

    expect(await markRow(db, id)).toEqual({
      score: 4,
      outcome: "full",
      feedback: "fb " + id.slice(1),
      outcome_changed: true,
    });
    const basis = await db.query<{ basis: string }>("select basis from mark where id = $1", [id]);
    expect(basis.rows[0].basis).toBe("official");
  });

  it("afterwards refuses a score above 5 or below 0 and accepts 0 to 5", async () => {
    const db = await databaseBeforeConversion();
    await applyMigration(db, files[2]);

    for (const bad of [6, 72, -1]) {
      await expect(
        insertMark(db, { score: bad, outcome: "full", mistakes: "[]" }),
      ).rejects.toThrow();
    }
    for (const good of [0, 3, 5]) {
      await expect(
        insertMark(db, { score: good, outcome: "full", mistakes: "[]" }),
      ).resolves.toBeTruthy();
    }
  });
});
