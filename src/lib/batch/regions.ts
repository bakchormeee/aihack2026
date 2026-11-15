// Pure rules for uploading working for several questions at once
// (SPEC-batch-working.md). Boxes are fractions of the photo (0–1), so they do not
// depend on the photo's pixel size. The margin is added once, when a proposal is
// read; the browser then crops each box exactly as it stands.

export const MAX_BATCH_PHOTOS = 10;
/** Same as MAX_IMAGES_PER_SUBMISSION: one crop is one image of the working. */
export const MAX_CROPS_PER_QUESTION = 10;
/** Added on every side so that nothing at the edge of the working is cut off. */
export const CROP_MARGIN = 0.02;
/** A side shorter than this (1% of the photo) is not a usable box. */
export const MIN_BOX_SIDE = 0.01;
/** Boxes whose tops are this close are on the same line and read left to right. */
const SAME_LINE = 0.05;

export type Box = { x: number; y: number; w: number; h: number };
export type Region = { photo: number; box: Box };
export type ProposedRegion = Region & { questionLabel: string | null };
export type Assignment = { questionId: string; regions: Region[] };

/** The box cut to the photo, or null when too little of it is left. */
export function clampBox(box: Box): Box | null {
  const values = [box.x, box.y, box.w, box.h];
  if (!values.every(Number.isFinite)) return null;
  const x = Math.max(0, box.x);
  const y = Math.max(0, box.y);
  // Left unchanged when inside the photo, so a box does not drift by rounding.
  const w = box.x < 0 || box.x + box.w > 1 ? Math.min(1, box.x + box.w) - x : box.w;
  const h = box.y < 0 || box.y + box.h > 1 ? Math.min(1, box.y + box.h) - y : box.h;
  if (w < MIN_BOX_SIDE || h < MIN_BOX_SIDE) return null;
  return { x, y, w, h };
}

/** The box grown by `margin` on every side, kept inside the photo. */
export function withMargin(box: Box, margin = CROP_MARGIN): Box {
  const x = Math.max(0, box.x - margin);
  const y = Math.max(0, box.y - margin);
  return {
    x,
    y,
    w: Math.min(1, box.x + box.w + margin) - x,
    h: Math.min(1, box.y + box.h + margin) - y,
  };
}

/** Photo by photo; on a photo top to bottom, and left to right on one line. */
export function readingOrder<T extends Region>(regions: readonly T[]): T[] {
  return [...regions].sort((a, b) => {
    if (a.photo !== b.photo) return a.photo - b.photo;
    if (Math.abs(a.box.y - b.box.y) >= SAME_LINE) return a.box.y - b.box.y;
    return a.box.x - b.box.x;
  });
}

/** "Q4(a)", "4 (a)" and "question 4a" all read as "4a". */
export function normaliseLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/question/g, "")
    .replace(/^\s*q(?=\s*\d)/, "")
    .replace(/[^a-z0-9]/g, "");
}

function isPhotoIndex(photo: number, photoCount: number): boolean {
  return Number.isInteger(photo) && photo >= 0 && photo < photoCount;
}

/**
 * Turns the AI's regions into one group per question, in the sheet's question order.
 * A region on an unknown photo or with an unusable box is dropped; one with no label
 * or a label that is not an eligible question is unmatched, and so is any region past
 * the 10th of one question.
 */
export function groupProposal(
  raw: readonly ProposedRegion[],
  questions: readonly { id: string; label: string }[],
  photoCount: number,
): { matched: Assignment[]; unmatched: Region[] } {
  const idByLabel = new Map(questions.map((q) => [normaliseLabel(q.label), q.id]));
  const byQuestion = new Map<string, Region[]>();
  let unmatched: Region[] = [];

  for (const r of raw) {
    if (!isPhotoIndex(r.photo, photoCount)) continue;
    const clamped = clampBox(r.box);
    if (!clamped) continue;
    const region = { photo: r.photo, box: withMargin(clamped) };
    const id =
      r.questionLabel === null ? undefined : idByLabel.get(normaliseLabel(r.questionLabel));
    if (id === undefined) unmatched.push(region);
    else byQuestion.set(id, [...(byQuestion.get(id) ?? []), region]);
  }

  const matched: Assignment[] = [];
  for (const q of questions) {
    const regions = byQuestion.get(q.id);
    if (!regions) continue;
    const ordered = readingOrder(regions);
    matched.push({ questionId: q.id, regions: ordered.slice(0, MAX_CROPS_PER_QUESTION) });
    unmatched = unmatched.concat(ordered.slice(MAX_CROPS_PER_QUESTION));
  }
  return { matched, unmatched: readingOrder(unmatched) };
}

/**
 * Checks what the student confirmed. Returns the message to show, or null when every
 * question can take working, every region is on an uploaded photo, and no question
 * has more than 10 regions.
 */
export function validateAssignments(
  assignments: readonly Assignment[],
  ctx: { photoCount: number; eligibleQuestionIds: ReadonlySet<string> },
): string | null {
  if (assignments.length === 0) return "Give at least one region to a question.";
  const seen = new Set<string>();
  for (const a of assignments) {
    if (!ctx.eligibleQuestionIds.has(a.questionId))
      return "A region was given to a question that cannot take working.";
    if (seen.has(a.questionId)) return "A question was given twice.";
    seen.add(a.questionId);
    if (a.regions.length === 0) return "Each question needs at least one region.";
    if (a.regions.length > MAX_CROPS_PER_QUESTION) return "A question can have at most 10 regions.";
    for (const r of a.regions) {
      if (!isPhotoIndex(r.photo, ctx.photoCount))
        return "A region is on a photo that was not uploaded.";
      if (!clampBox(r.box)) return "A region is outside its photo.";
    }
  }
  return null;
}
