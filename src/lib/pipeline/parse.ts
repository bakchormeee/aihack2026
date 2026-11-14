// Background job: read an uploaded sheet with the AI and save its questions
// and topics (task M3). Safe to run twice: only one run can save.

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import { questionTopics, questions, sheetFiles, sheets, topicPrereqs, topics } from "@/db/schema";
import { parseSheet, type ParsedSheet } from "@/lib/ai/parse-sheet";
import { getObjectBytes } from "@/lib/storage";

export type ParseIo = { readFile: (key: string) => Promise<Buffer> };

const defaultIo: ParseIo = { readFile: getObjectBytes };

export const PARSE_FAILED_MESSAGE =
  "We could not read this sheet. Try again, or upload clearer pages.";

const lower = (name: string) => name.trim().toLowerCase();

export async function runParse(sheetId: string, io: ParseIo = defaultIo): Promise<void> {
  const [sheet] = await db.select().from(sheets).where(eq(sheets.id, sheetId));
  if (!sheet || sheet.status !== "parsing") return;

  try {
    const files = await db
      .select()
      .from(sheetFiles)
      .where(and(eq(sheetFiles.sheetId, sheetId), eq(sheetFiles.kind, "sheet")))
      .orderBy(asc(sheetFiles.position));
    const existing = await db
      .select({ name: topics.name })
      .from(topics)
      .where(eq(topics.courseId, sheet.courseId));

    const parsed = await parseSheet({
      files: await Promise.all(
        files.map(async (file) => ({ mime: file.mime, data: await io.readFile(file.path) })),
      ),
      existingTopics: existing.map((topic) => topic.name),
    });
    await saveParsed(sheet.id, sheet.courseId, parsed);
  } catch (error) {
    console.error(`parse of sheet ${sheetId} failed`, error);
    await db
      .update(sheets)
      .set({ status: "failed", statusUpdatedAt: new Date(), error: PARSE_FAILED_MESSAGE })
      .where(and(eq(sheets.id, sheetId), eq(sheets.status, "parsing")));
  }
}

async function saveParsed(sheetId: string, courseId: string, parsed: ParsedSheet): Promise<void> {
  await db.transaction(async (tx) => {
    // Claim the result: whichever run gets here first saves, the others stop.
    const claimed = await tx
      .update(sheets)
      .set({ status: "ready", statusUpdatedAt: new Date(), error: null })
      .where(and(eq(sheets.id, sheetId), eq(sheets.status, "parsing")))
      .returning({ id: sheets.id });
    if (claimed.length === 0) return;

    const before = await tx.select().from(topics).where(eq(topics.courseId, courseId));
    const known = new Set(before.map((topic) => lower(topic.name)));

    // Every name the result mentions, in a stable order. A parent or
    // prerequisite is often not listed as a new topic itself.
    const mentioned = [
      ...parsed.newTopics.flatMap((t) => [
        t.name,
        ...(t.parent ? [t.parent] : []),
        ...t.prerequisites,
      ]),
      ...parsed.questions.flatMap((q) => q.topics),
    ];
    const toCreate = [
      ...new Map(mentioned.map((name) => [lower(name), name.trim()])).entries(),
    ].filter(([key]) => !known.has(key));
    if (toCreate.length > 0) {
      await tx
        .insert(topics)
        .values(toCreate.map(([, name]) => ({ courseId, name })))
        .onConflictDoNothing();
    }

    const all = await tx.select().from(topics).where(eq(topics.courseId, courseId));
    const byName = new Map(all.map((topic) => [lower(topic.name), topic]));
    const created = new Set(toCreate.map(([key]) => key));

    for (const topic of parsed.newTopics) {
      const self = byName.get(lower(topic.name));
      if (!self || !created.has(lower(topic.name))) continue;

      const parent = topic.parent ? byName.get(lower(topic.parent)) : undefined;
      if (parent && parent.id !== self.id) {
        await tx.update(topics).set({ parentId: parent.id }).where(eq(topics.id, self.id));
      }
      const links = topic.prerequisites
        .map((name) => byName.get(lower(name)))
        .filter(
          (prereq): prereq is NonNullable<typeof prereq> =>
            prereq !== undefined && prereq.id !== self.id,
        )
        .map((prereq) => ({ topicId: self.id, prereqId: prereq.id }));
      if (links.length > 0) await tx.insert(topicPrereqs).values(links).onConflictDoNothing();
    }

    const saved = await tx
      .insert(questions)
      .values(
        parsed.questions.map((question, index) => ({
          courseId,
          sheetId,
          position: index + 1,
          label: question.label,
          body: question.body,
          expectedMinutes: question.expectedMinutes,
        })),
      )
      .returning({ id: questions.id, position: questions.position });

    const tags = saved.flatMap((row) =>
      parsed.questions[row.position - 1].topics.map((name) => ({
        questionId: row.id,
        topicId: byName.get(lower(name))!.id,
      })),
    );
    await tx.insert(questionTopics).values(tags).onConflictDoNothing();
  });
}
