import { describe, expect, it } from "vitest";

import { buildHandInInput, pdfSafeText, planHandIn, type HandInQuestion } from "./hand-in";

const d = (minutes: number) => new Date(Date.UTC(2026, 10, 1, 10, minutes));

function attempt(o: {
  startedAt: number;
  submitted?: number | null;
  text?: string | null;
  files?: { id: string; mime: string }[];
}) {
  return {
    startedAt: d(o.startedAt),
    submission:
      o.submitted === null
        ? { text: o.text ?? null, submittedAt: null, files: o.files ?? [] }
        : {
            text: o.text ?? null,
            submittedAt: d(o.submitted ?? o.startedAt + 1),
            files: (o.files ?? []).map((f, i) => ({ ...f, position: i })),
          },
  };
}

describe("buildHandInInput", () => {
  it("uses the newest submitted attempt of each question, in the given order", () => {
    const input = buildHandInInput([
      {
        label: "1",
        attempts: [attempt({ startedAt: 1, text: "old" }), attempt({ startedAt: 5, text: "new" })],
      },
      { label: "2", attempts: [] },
    ]);
    expect(input).toEqual([
      { label: "1", text: "new", files: [] },
      { label: "2", text: null, files: null },
    ]);
  });

  it("ignores drafts and attempts without a submission", () => {
    const input = buildHandInInput([
      {
        label: "1",
        attempts: [
          attempt({ startedAt: 1, text: "submitted" }),
          attempt({ startedAt: 9, submitted: null, text: "draft" }),
          { startedAt: d(12), submission: null },
        ],
      },
    ]);
    expect(input[0].text).toBe("submitted");
  });

  it("treats blank typed text as no text", () => {
    const [q] = buildHandInInput([
      {
        label: "1",
        attempts: [
          attempt({ startedAt: 1, text: "  \n", files: [{ id: "f", mime: "image/png" }] }),
        ],
      },
    ]);
    expect(q.text).toBeNull();
    expect(q.files).toEqual([{ id: "f", mime: "image/png" }]);
  });

  it("carries only the label, text and files: no marks, hints or feedback", () => {
    const [q] = buildHandInInput([
      {
        label: "1",
        attempts: [
          { ...attempt({ startedAt: 1, text: "t" }), marks: [{ score: 9 }], hintLevel: 3 } as never,
        ],
      },
    ]);
    expect(Object.keys(q).sort()).toEqual(["files", "label", "text"]);
  });
});

describe("planHandIn", () => {
  const questions: HandInQuestion[] = [
    { label: "1", text: "x = 1", files: [] },
    {
      label: "2",
      text: null,
      files: [
        { id: "a", mime: "image/jpeg" },
        { id: "b", mime: "image/png" },
      ],
    },
    { label: "3", text: null, files: null },
    { label: "4", text: "see attached", files: [{ id: "c", mime: "application/pdf" }] },
    { label: "5", text: null, files: null },
  ];

  it("orders pages by question, typed working before files, photos one per page", () => {
    const plan = planHandIn(questions);
    expect(plan).toEqual([
      { kind: "text", label: "1", continued: false, text: "x = 1" },
      { kind: "image", label: "2", continued: false, fileId: "a", mime: "image/jpeg" },
      { kind: "image", label: "2", continued: true, fileId: "b", mime: "image/png" },
      { kind: "text", label: "4", continued: false, text: "see attached" },
      { kind: "pdf", label: "4", continued: true, fileId: "c" },
      { kind: "notAttempted", labels: ["3", "5"] },
    ]);
  });

  it("lists every question as not attempted when nothing was submitted", () => {
    expect(planHandIn([{ label: "1", text: null, files: null }])).toEqual([
      { kind: "notAttempted", labels: ["1"] },
    ]);
  });

  it("has no not-attempted page when every question has working", () => {
    expect(
      planHandIn([{ label: "1", text: "a", files: [] }]).some((p) => p.kind === "notAttempted"),
    ).toBe(false);
  });

  it("gives a submitted question with empty working its own note rather than dropping it", () => {
    const plan = planHandIn([{ label: "1", text: null, files: [] }]);
    expect(plan).toEqual([{ kind: "notAttempted", labels: ["1"] }]);
  });
});

describe("pdfSafeText", () => {
  it("keeps plain labels and replaces characters the PDF font cannot draw", () => {
    expect(pdfSafeText("1(a)")).toBe("1(a)");
    expect(pdfSafeText("Q∑2")).toBe("Q?2");
  });
});
