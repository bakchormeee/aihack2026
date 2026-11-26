import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { db } from "@/db";
import {
  attempts,
  courses,
  marks,
  questions,
  sheets,
  solutions,
  submissionFiles,
  submissions,
  users,
} from "@/db/schema";
import type { Mistake } from "@/lib/domain";

vi.mock("@/lib/auth/session", () => ({ requireUser: async () => ({ id: "" }) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

import { AttemptEvaluation, hintsText } from "./attempt-evaluation";

type Seed = {
  markStatus?: "none" | "pending" | "done" | "failed" | "awaiting_official";
  mark?: { score: number; outcome: "full" | "partial" | "stuck"; basis?: "ai" | "official" } | null;
  mistakes?: Mistake[];
  text?: string;
  files?: { mime: string }[];
  solutions?: ("ai" | "official")[];
};

async function world(email: string, seed: Seed = {}) {
  const [user] = await db.insert(users).values({ email }).returning();
  const [course] = await db.insert(courses).values({ userId: user.id, name: "C" }).returning();
  const [sheet] = await db
    .insert(sheets)
    .values({ courseId: course.id, title: "S", status: "ready" })
    .returning();
  const [question] = await db
    .insert(questions)
    .values({
      courseId: course.id,
      sheetId: sheet.id,
      position: 1,
      label: "1",
      body: "Prove P.",
      expectedMinutes: 5,
    })
    .returning();
  const [attempt] = await db
    .insert(attempts)
    .values({ userId: user.id, questionId: question.id, context: "sheet" })
    .returning();
  const [submission] = await db
    .insert(submissions)
    .values({
      attemptId: attempt.id,
      text: seed.text ?? "x = 1",
      submittedAt: new Date(),
      markStatus: seed.markStatus ?? "done",
    })
    .returning();
  for (const [position, file] of (seed.files ?? []).entries())
    await db
      .insert(submissionFiles)
      .values({ submissionId: submission.id, path: `u/f${position}`, mime: file.mime, position });
  for (const basis of seed.solutions ?? [])
    await db
      .insert(solutions)
      .values({ questionId: question.id, basis, body: `${basis} solution text` });
  if (seed.mark !== null) {
    const mark = seed.mark ?? { score: 3, outcome: "partial" as const };
    await db.insert(marks).values({
      attemptId: attempt.id,
      basis: mark.basis ?? "ai",
      score: mark.score,
      outcome: mark.outcome,
      errorType: mark.outcome === "full" ? null : "method",
      mistakes: seed.mistakes ?? null,
      feedback: "Check the second line.",
      overallFeedback: "Nearly there.",
    });
  }
  return { user, question, attempt };
}

const html = async (w: Awaited<ReturnType<typeof world>>) =>
  renderToStaticMarkup(
    (await AttemptEvaluation({
      userId: w.user.id,
      question: w.question,
      attemptId: w.attempt.id,
    })) as React.ReactElement,
  );

const typed = (quote: string): Mistake => ({
  type: "method",
  quote,
  hint: `Look at ${quote}`,
  location: { kind: "text" },
});
const onPhoto = (fileIndex: number): Mistake => ({
  type: "algebra_slip",
  quote: "photo step",
  hint: "Photo hint",
  location: { kind: "image", fileIndex, box: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } },
});
const onPdf = (page: number): Mistake => ({
  type: "method",
  quote: "pdf step",
  hint: "Pdf hint",
  location: { kind: "pdf", fileIndex: 0, page },
});

describe("AttemptEvaluation", () => {
  it("shows the score line, the feedback and the way to try again", async () => {
    const out = await html(await world("ae-done@test.local"));
    expect(out).toContain("3 / 5");
    expect(out).toContain("· Partial");
    expect(out).toContain("Method · no hints · AI-marked, provisional");
    expect(out).toContain("Check the second line.");
    expect(out).toContain("Retry now");
    expect(out).toContain("Ask for a re-mark (2 left)");
  });

  it("names a full outcome below 5 'Correct, slips'", async () => {
    const out = await html(
      await world("ae-slips@test.local", { mark: { score: 4, outcome: "full" } }),
    );
    expect(out).toContain("4 / 5");
    expect(out).toContain("· Correct, slips");
    expect(out).not.toContain("Retry now");
  });

  it("shows the waiting state while the AI marks, with the working", async () => {
    const out = await html(
      await world("ae-pending@test.local", { markStatus: "pending", mark: null }),
    );
    expect(out).toContain("Marking your working…");
    expect(out).toContain("Your working (submitted)");
    expect(out).toContain("x = 1");
  });

  it("shows a waiting submission with its working and the way to mark it with the AI", async () => {
    const out = await html(
      await world("ae-waiting@test.local", { markStatus: "awaiting_official", mark: null }),
    );
    expect(out).toContain("Marked when the official solutions are uploaded.");
    expect(out).toContain("Mark with AI instead");
    expect(out).toContain("Your working (submitted)");
    expect(out).toContain("x = 1");
    // No score, feedback or marking state while it waits.
    expect(out).not.toContain(" / 5");
    expect(out).not.toContain("Marking your working…");
    expect(out).not.toContain("Mark my working");
  });

  it("does not offer that when the submission is marked", async () => {
    expect(await html(await world("ae-notwaiting@test.local"))).not.toContain(
      "Mark with AI instead",
    );
  });

  it("offers to mark again when marking failed", async () => {
    const out = await html(
      await world("ae-failed@test.local", { markStatus: "failed", mark: null }),
    );
    expect(out).toContain("We could not mark your working.");
    expect(out).toContain("Mark my working");
  });

  it("shows nothing for an attempt at another question", async () => {
    const w = await world("ae-other@test.local");
    const out = await AttemptEvaluation({
      userId: w.user.id,
      question: { id: "another-question", hintsStatus: "ready" },
      attemptId: w.attempt.id,
    });
    expect(out).toBeNull();
  });

  describe("the working, by type", () => {
    it("numbers the mistakes once across the typed text, the photos and the list", async () => {
      const out = await html(
        await world("ae-typed-photo@test.local", {
          text: "Start $x = 3$ done",
          files: [{ mime: "image/jpeg" }],
          mistakes: [typed("$x = 3$"), onPhoto(0)],
        }),
      );
      // Typed box 1 and photo box 2, and the same two notes.
      expect(out).toMatch(/data-mistake="1"[^>]*data-severity="structural"/);
      expect(out).toMatch(/data-mistake="2"[^>]*data-severity="careless"/);
      expect(out).toContain('data-note="1"');
      expect(out).toContain('data-note="2"');
      expect(out).toContain("Photo 1");
      expect(out.indexOf("Start")).toBeLessThan(out.indexOf("<img"));
      expect(out.indexOf("<img")).toBeLessThan(out.indexOf('data-note="1"'));
    });

    it("lists a mistake with no position without a number, and numbers the rest from 1", async () => {
      const out = await html(
        await world("ae-nopos@test.local", {
          text: "Start $x = 3$ done",
          mistakes: [typed("never written"), typed("$x = 3$")],
        }),
      );
      expect(out).toContain('data-mistake="1"');
      expect(out).not.toContain('data-mistake="2"');
      expect(out).toContain("Look at never written"); // still listed
      expect(out.match(/data-note="/g)).toHaveLength(1);
    });

    it("shows a PDF with each note saying its page and no boxes", async () => {
      const out = await html(
        await world("ae-pdf@test.local", {
          text: "",
          files: [{ mime: "application/pdf" }],
          mistakes: [onPdf(2)],
        }),
      );
      expect(out).toContain("Open the PDF");
      expect(out).toContain("Page 2");
      expect(out).not.toContain("data-mistake=");
      expect(out).toContain('data-note="1"');
    });

    it("still shows the working when there are no mistakes", async () => {
      const out = await html(
        await world("ae-nomist@test.local", {
          mark: { score: 5, outcome: "full" },
          files: [{ mime: "image/png" }],
        }),
      );
      expect(out).toContain("x = 1");
      expect(out).toContain("/api/files/submission");
      expect(out).not.toContain("data-note");
    });
  });

  describe("the solution", () => {
    const full = { score: 5, outcome: "full" as const };

    it("labels an AI-written solution, collapsed", async () => {
      const out = await html(await world("ae-ai@test.local", { mark: full, solutions: ["ai"] }));
      expect(out).toContain("AI-written solution");
      expect(out).toContain("ai solution text");
      expect(out).not.toContain("Official solution");
    });

    it("shows only the official solution once one exists, never the AI one", async () => {
      const out = await html(
        await world("ae-off@test.local", {
          mark: { ...full, basis: "official" },
          solutions: ["ai", "official"],
        }),
      );
      expect(out).toContain("Official solution");
      expect(out).toContain("official solution text");
      expect(out).not.toContain("ai solution text");
      expect(out).not.toContain("AI-written solution");
      expect(out).toContain("AI-marked against the official solutions");
    });

    it("keeps the solution out of the page while it is locked", async () => {
      const out = await html(await world("ae-locked@test.local", { solutions: ["official"] }));
      expect(out).not.toContain("official solution text");
    });

    it("says the official re-mark is running while the AI mark is shown", async () => {
      const out = await html(
        await world("ae-remark@test.local", {
          markStatus: "pending",
          mark: { score: 3, outcome: "partial" },
          solutions: ["official"],
        }),
      );
      expect(out).toContain("Re-marking against the official solution…");
      expect(out).toContain("3 / 5");
    });

    it("says it is marking again after a re-mark request with no official solution", async () => {
      const out = await html(
        await world("ae-again@test.local", {
          markStatus: "pending",
          mark: { score: 3, outcome: "partial" },
        }),
      );
      expect(out).toContain("Marking again…");
    });
  });
});

describe("hintsText", () => {
  it("counts the hints", () => {
    expect(hintsText(0)).toBe("no hints");
    expect(hintsText(1)).toBe("1 hint");
    expect(hintsText(3)).toBe("3 hints");
  });
});
