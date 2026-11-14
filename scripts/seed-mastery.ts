// Dev only: gives one test user two courses with topic trees, ready sheets,
// questions with hints and solutions, and weeks of marked attempts, so the
// skill map, revision and progress pages have something to show.
// Run: npx tsx --env-file=.env.local scripts/seed-mastery.ts [email]

import { eq } from "drizzle-orm";

import { db } from "../src/db";
import {
  attempts,
  courses,
  hintReveals,
  hints,
  marks,
  questions,
  questionTopics,
  sheets,
  solutions,
  submissions,
  topicPrereqs,
  topics,
  users,
} from "../src/db/schema";

const email = process.argv[2] ?? "track-v@test.local";
const DAY = 24 * 60 * 60 * 1000;

const COURSES = [
  {
    name: "Analysis I (seed)",
    tree: [
      { name: "Sequences", parent: null, prereqs: [] },
      { name: "Series", parent: null, prereqs: ["Sequences"] },
      { name: "Convergence tests", parent: "Series", prereqs: ["Series"] },
      { name: "Continuity", parent: null, prereqs: ["Sequences"] },
      { name: "Differentiation", parent: null, prereqs: ["Continuity"] },
    ],
  },
  {
    name: "Linear Algebra (seed)",
    tree: [
      { name: "Matrices", parent: null, prereqs: [] },
      { name: "Determinants", parent: null, prereqs: ["Matrices"] },
      { name: "Eigenvalues", parent: null, prereqs: ["Determinants"] },
      { name: "Vector spaces", parent: null, prereqs: [] },
    ],
  },
];

const OUTCOMES = ["full", "partial", "stuck", "full", "partial", "full"] as const;

async function main() {
  const [existing] = await db.select().from(users).where(eq(users.email, email));
  const user = existing ?? (await db.insert(users).values({ email }).returning())[0];

  for (const spec of COURSES) {
    const [course] = await db.insert(courses).values({ userId: user.id, name: spec.name }).returning();
    const byName = new Map<string, string>();
    for (const t of spec.tree) {
      const [row] = await db
        .insert(topics)
        .values({
          courseId: course.id,
          name: t.name,
          parentId: t.parent ? byName.get(t.parent) : null,
        })
        .returning();
      byName.set(t.name, row.id);
    }
    for (const t of spec.tree)
      for (const p of t.prereqs)
        if (p !== t.name)
          await db.insert(topicPrereqs).values({ topicId: byName.get(t.name)!, prereqId: byName.get(p)! });

    for (let s = 0; s < 2; s++) {
      const [sheet] = await db
        .insert(sheets)
        .values({
          courseId: course.id,
          title: `Problem sheet ${s + 1}`,
          status: "ready",
          uploadedAt: new Date(Date.now() - (40 - s * 14) * DAY),
        })
        .returning();
      for (let n = 0; n < spec.tree.length; n++) {
        const topic = spec.tree[n];
        const [q] = await db
          .insert(questions)
          .values({
            courseId: course.id,
            sheetId: sheet.id,
            position: n + 1,
            label: `${n + 1}`,
            body: `Question ${s + 1}.${n + 1} on ${topic.name}: show that $x_n \\to 0$ where $x_n = 1/n^${n + 1}$.`,
            expectedMinutes: 10,
            hintsStatus: "ready",
          })
          .returning();
        await db.insert(questionTopics).values({ questionId: q.id, topicId: byName.get(topic.name)! });
        const hintRows = await db
          .insert(hints)
          .values([1, 2, 3].map((level) => ({ questionId: q.id, level, body: `Hint ${level}` })))
          .returning();
        await db.insert(solutions).values({ questionId: q.id, basis: "ai", body: "Worked solution." });

        // Several attempts per question over the weeks; the second course is weaker.
        for (let k = 0; k < 3; k++) {
          const pick = (n + k + s + (spec.name.startsWith("Linear") ? 1 : 0)) % OUTCOMES.length;
          const outcome = OUTCOMES[pick];
          const [a] = await db
            .insert(attempts)
            .values({
              userId: user.id,
              questionId: q.id,
              context: "sheet",
              startedAt: new Date(Date.now() - (35 - s * 12 - k * 4 - n) * DAY),
              secondsSpent: 300 + n * 60,
            })
            .returning();
          const hintUsed = outcome === "full" ? (k + n) % 4 : 0;
          if (hintUsed > 0)
            await db
              .insert(hintReveals)
              .values(hintRows.filter((h) => h.level <= hintUsed).map((h) => ({ attemptId: a.id, hintId: h.id })));
          await db.insert(submissions).values({
            attemptId: a.id,
            text: "My working.",
            submittedAt: a.startedAt,
            markStatus: "done",
          });
          await db.insert(marks).values({
            attemptId: a.id,
            basis: "ai",
            score: outcome === "full" ? 95 : outcome === "partial" ? 55 : 10,
            outcome,
            errorType: outcome === "full" ? null : "method",
            firstWrongStep: outcome === "full" ? null : "Step 2",
            feedback: "Seeded feedback.",
            overallFeedback: "Seeded.",
            createdAt: a.startedAt,
          });
        }
      }
    }
  }
  console.log(`Seeded ${COURSES.length} courses for ${email}`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
