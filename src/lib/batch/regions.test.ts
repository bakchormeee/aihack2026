import { describe, expect, it } from "vitest";

import {
  CROP_MARGIN,
  MAX_BATCH_PHOTOS,
  MAX_CROPS_PER_QUESTION,
  clampBox,
  groupProposal,
  normaliseLabel,
  readingOrder,
  validateAssignments,
  withMargin,
} from "./regions";

const box = (x: number, y: number, w = 0.2, h = 0.2) => ({ x, y, w, h });

describe("limits", () => {
  it("allows 10 photos and 10 crops for one question", () => {
    expect(MAX_BATCH_PHOTOS).toBe(10);
    expect(MAX_CROPS_PER_QUESTION).toBe(10);
  });
});

describe("clampBox", () => {
  it("keeps a box that is inside the photo", () => {
    expect(clampBox(box(0.1, 0.2, 0.3, 0.4))).toEqual(box(0.1, 0.2, 0.3, 0.4));
  });

  it("cuts a box at the edges of the photo", () => {
    expect(clampBox({ x: -0.1, y: 0.8, w: 0.5, h: 0.5 })).toEqual({
      x: 0,
      y: 0.8,
      w: 0.4,
      h: expect.closeTo(0.2, 10),
    });
  });

  it("refuses a box that is outside the photo, too small or not a number", () => {
    expect(clampBox(box(1.2, 0.1))).toBeNull();
    expect(clampBox(box(0.1, 0.1, 0.005, 0.5))).toBeNull();
    expect(clampBox(box(0.1, 0.1, 0.5, 0))).toBeNull();
    expect(clampBox({ x: Number.NaN, y: 0, w: 0.5, h: 0.5 })).toBeNull();
  });
});

describe("withMargin", () => {
  it("grows the box by the margin on every side", () => {
    const grown = withMargin(box(0.2, 0.2, 0.2, 0.2));
    expect(grown.x).toBeCloseTo(0.2 - CROP_MARGIN);
    expect(grown.y).toBeCloseTo(0.2 - CROP_MARGIN);
    expect(grown.w).toBeCloseTo(0.2 + 2 * CROP_MARGIN);
    expect(grown.h).toBeCloseTo(0.2 + 2 * CROP_MARGIN);
  });

  it("does not grow past the edges of the photo", () => {
    expect(withMargin(box(0, 0, 1, 1))).toEqual(box(0, 0, 1, 1));
  });
});

describe("readingOrder", () => {
  it("orders by photo, then top to bottom, then left to right on the same line", () => {
    const regions = [
      { photo: 1, box: box(0.1, 0.1) },
      { photo: 0, box: box(0.1, 0.6) },
      { photo: 0, box: box(0.55, 0.11) },
      { photo: 0, box: box(0.05, 0.1) },
    ];

    expect(readingOrder(regions)).toEqual([
      { photo: 0, box: box(0.05, 0.1) },
      { photo: 0, box: box(0.55, 0.11) },
      { photo: 0, box: box(0.1, 0.6) },
      { photo: 1, box: box(0.1, 0.1) },
    ]);
  });

  it("does not change the list it is given", () => {
    const regions = [
      { photo: 1, box: box(0, 0) },
      { photo: 0, box: box(0, 0) },
    ];
    readingOrder(regions);
    expect(regions[0].photo).toBe(1);
  });
});

describe("normaliseLabel", () => {
  it.each([
    ["Q4(a)", "4a"],
    ["4 (a)", "4a"],
    ["Question 3", "3"],
    ["  2.b ", "2b"],
    ["q10(ii)", "10ii"],
  ])("reads %s as %s", (label, expected) => {
    expect(normaliseLabel(label)).toBe(expected);
  });
});

describe("groupProposal", () => {
  const questions = [
    { id: "q1", label: "1" },
    { id: "q2", label: "2(a)" },
    { id: "q3", label: "2(b)" },
  ];

  it("groups regions by question in reading order, with margin and clamping", () => {
    const result = groupProposal(
      [
        { photo: 1, box: box(0.1, 0.1), questionLabel: "Q2(a)" },
        { photo: 0, box: box(0.1, 0.5), questionLabel: "1" },
        { photo: 0, box: box(0.1, 0.8, 0.5, 0.5), questionLabel: "2a" },
      ],
      questions,
      2,
    );

    expect(result.matched.map((m) => m.questionId)).toEqual(["q1", "q2"]);
    expect(result.matched[1].regions.map((r) => r.photo)).toEqual([0, 1]);
    expect(result.matched[1].regions[0].box.y + result.matched[1].regions[0].box.h).toBe(1);
    expect(result.matched[0].regions[0].box.x).toBeCloseTo(0.1 - CROP_MARGIN);
    expect(result.unmatched).toEqual([]);
  });

  it("puts regions with no label or an unknown label in unmatched", () => {
    const result = groupProposal(
      [
        { photo: 0, box: box(0.1, 0.1), questionLabel: null },
        { photo: 0, box: box(0.1, 0.5), questionLabel: "7" },
      ],
      questions,
      1,
    );

    expect(result.matched).toEqual([]);
    expect(result.unmatched.map((r) => r.box.y)).toEqual([
      expect.closeTo(0.1 - CROP_MARGIN, 10),
      expect.closeTo(0.5 - CROP_MARGIN, 10),
    ]);
  });

  it("drops regions on an unknown photo or with an unusable box", () => {
    const result = groupProposal(
      [
        { photo: 3, box: box(0.1, 0.1), questionLabel: "1" },
        { photo: -1, box: box(0.1, 0.1), questionLabel: "1" },
        { photo: 0.5, box: box(0.1, 0.1), questionLabel: "1" },
        { photo: 0, box: box(2, 2), questionLabel: "1" },
      ],
      questions,
      2,
    );

    expect(result).toEqual({ matched: [], unmatched: [] });
  });

  it("keeps the first 10 regions of a question and moves the rest to unmatched", () => {
    const raw = Array.from({ length: 12 }, (_, i) => ({
      photo: 0,
      box: box(0.1, i * 0.08, 0.2, 0.05),
      questionLabel: "1",
    }));

    const result = groupProposal(raw, questions, 1);

    expect(result.matched[0].regions).toHaveLength(10);
    expect(result.unmatched).toHaveLength(2);
  });

  it("matches labels that are the same after normalising", () => {
    const result = groupProposal(
      [{ photo: 0, box: box(0.1, 0.1), questionLabel: "question 2 (b)" }],
      questions,
      1,
    );
    expect(result.matched[0].questionId).toBe("q3");
  });
});

describe("validateAssignments", () => {
  const ctx = { photoCount: 2, eligibleQuestionIds: new Set(["q1", "q2"]) };
  const region = { photo: 0, box: box(0.1, 0.1) };

  it("accepts regions on known photos for eligible questions", () => {
    expect(
      validateAssignments(
        [
          { questionId: "q1", regions: [region] },
          { questionId: "q2", regions: [region, { photo: 1, box: box(0.5, 0.5) }] },
        ],
        ctx,
      ),
    ).toBeNull();
  });

  it("refuses an unknown, another sheet's or a submitted question", () => {
    expect(validateAssignments([{ questionId: "q9", regions: [region] }], ctx)).toBe(
      "A region was given to a question that cannot take working.",
    );
  });

  it("refuses an unknown photo", () => {
    expect(
      validateAssignments([{ questionId: "q1", regions: [{ photo: 2, box: box(0, 0) }] }], ctx),
    ).toBe("A region is on a photo that was not uploaded.");
  });

  it("refuses an unusable box", () => {
    expect(
      validateAssignments([{ questionId: "q1", regions: [{ photo: 0, box: box(5, 5) }] }], ctx),
    ).toBe("A region is outside its photo.");
  });

  it("refuses a question named twice, a question with no region, and more than 10 regions", () => {
    expect(
      validateAssignments(
        [
          { questionId: "q1", regions: [region] },
          { questionId: "q1", regions: [region] },
        ],
        ctx,
      ),
    ).toBe("A question was given twice.");
    expect(validateAssignments([{ questionId: "q1", regions: [] }], ctx)).toBe(
      "Each question needs at least one region.",
    );
    expect(validateAssignments([{ questionId: "q1", regions: Array(11).fill(region) }], ctx)).toBe(
      "A question can have at most 10 regions.",
    );
  });

  it("refuses an empty confirmation", () => {
    expect(validateAssignments([], ctx)).toBe("Give at least one region to a question.");
  });
});
