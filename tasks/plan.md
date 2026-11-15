# Implementation Plan: Deleting courses and sheets; working for several questions at once

Source specs: [SPEC-delete.md](../SPEC-delete.md) (tasks D1–D6) and
[SPEC-batch-working.md](../SPEC-batch-working.md) (tasks B1–B5) · Tasks: [todo.md](todo.md)

## Overview

Two independent features, planned together so they can be built side by side:

- **Delete:** a course or a sheet goes to a bin for 30 days, can be restored from
  "Recently deleted", and is then erased with its history and files.
- **Batch working:** from the sheet page the student uploads up to 10 photos; the AI
  proposes which region of which photo answers which question; the student checks and
  corrects that; each matched question is then submitted and marked.

## What the code looks like today (from reading it)

| Area | Where | Today |
|---|---|---|
| Ownership | `requireCourse`, `requireSheet`, `requireQuestion`, `requireAttempt` (`src/lib/auth/ownership.ts`); pages use `orNotFound(...)` | One place to turn a binned item into a 404 |
| Lists and history | `listCourses`, `listSheets`, `getCourseSheetOverview`, `getSheetHistory`, `listMistakes`, the hand-in export | Each reads courses, sheets or questions directly |
| Mastery and reviews | `getCourseMastery`, `getCourseEvents` (`src/db/queries/mastery.ts`); spot answers count too | Evidence is every marked attempt of the course |
| Common errors | `listMisconceptions`, `findUnreadMarks` (`src/db/queries/misconceptions.ts`) | Times seen counts every source |
| Revision | `listRetryCandidates`, `getRevisionSession` (`src/db/queries/revision.ts`), `buildSpotSession` | Candidates come from every question of the course |
| Erasing rows | `eraseDemoUser` (`src/db/queries/demo.ts`) deletes history in foreign-key order, then files under one folder | The order and the file rule can be reused |
| Working | `openAttemptFor`, `addDraftFiles` (10 images at most), `submitWorking`, `submitAllDrafts`; `submitAllAction` claims and marks with `mapLimit` in `after()` | The batch submit ends in the same calls |
| Uploads | `/api/uploads/presign` checks the parent by purpose (`sheet`, `official_solutions`, `working`); `buildKey`; `verifyUploadedObject`; `src/lib/image-resize.ts` resizes on a canvas | Batch photos need their own purpose; cropping extends the resize helper |
| AI | `callAi` with a schema and fixtures; `withAiUser` and `demoAiRefusal` (`src/lib/ai/budget.ts`) | One new wrapper, `matchWorking` |

## Architecture decisions

### Delete

1. **Migration F (0005)** adds `deleted_at` (nullable time) to `course` and `sheet`.
   Binning sets it, Restore clears it, and nothing else is written (spec assumption 1).
2. **What is binned is computed, in one place.** Pure rules in `src/lib/bin/rules.ts`
   (100% coverage): from the course's sheets and questions, the set of binned question
   ids (a question of a binned sheet, and every variant whose chain of parents reaches
   one); whether an item is due for erasing (30 days); the dialog sentence from counts.
   `src/db/queries/bin.ts` loads the rows and exposes `binnedQuestionIds(courseId)`
   and the SQL conditions `liveCourse` / `liveSheet` for the queries above.
3. **A binned item is a 404 through the guards.** `requireCourse`, `requireSheet`,
   `requireQuestion`, `requireAttempt` and `requireRevisionSession` refuse binned items,
   so every page, action and file download follows without its own check. Restore and
   the bin page use separate queries that read binned rows on purpose.
4. **Erasing reuses the demo erase order** (hint reveals, submission files, submissions,
   marks, revision items, attempts, then the sheet or course, which cascades). A file is
   deleted only if no remaining row has the same path (retries share photos) and the
   path is under the user's own folder, which also protects the demo student's files in
   a demo copy. It runs in `after()` from the courses list and the bin page.
5. `src/lib/auth/ownership.ts` and `src/db/schema.ts` are frozen files; the coordinator
   edits them in D1 and D2.

### Batch working

6. **Pure geometry and rules in `src/lib/batch/regions.ts`** (100% coverage): boxes as
   fractions of the photo (0–1), clamping, the margin around a crop, reading order, the
   limit of 10 crops for one question, and checking a proposal or a confirmation against
   the sheet (known question, known photo, question can take working).
7. **`matchWorking` is one AI wrapper** (`src/lib/ai/match-working.ts`) with a schema,
   a fixture and tests: input the photos and each eligible question's label and body;
   output regions `{ photo, box, questionLabel | null }`. Labels are mapped back to
   question ids on the server; an unknown label becomes unmatched.
8. **Photos get their own upload purpose, `batch`,** with the sheet as parent
   (`u/<user>/batch/<sheetId>/…`). This changes the frozen `keys.ts` and the presign
   route (coordinator). No table: the pending upload lives in the browser. Photos left
   behind are deleted when the sheet page is next opened, by listing that folder, which
   needs a small `listObjects` in `s3.ts`.
9. **Cropping is in the browser** (`cropImage` beside the resize helper): on confirm
   each region is cut out, uploaded with purpose `working` to the question's attempt,
   and one server action `submitBatchAction` verifies every key and question, adds the
   crops to each draft, submits, claims the marks and marks in `after()` with
   `mapLimit`, as `submitAllAction` does, then deletes the photos.
10. **Demo limit:** both the matching action and the submit action check that the copy
    has enough calls left (1 for matching, 1 for each matched question) through a new
    `demoAiCallsLeft` in `budget.ts`.

## Dependency graph

```
D1 migration F + bin rules ─► D2 bin, restore, 404 ─► D3 hidden from mastery, lists, revision
                                         └─► D4 dialogs + Recently deleted ─► D5 erase after 30 days
B1 region rules ─► B2 matchWorking + propose action ─► B3 submit action ─► B4 review screen
D5 + B4 ─► D6 / B5 end-to-end ─► release
```

The two tracks share only `src/app/(app)/sheets/[sheetId]/page.tsx` (each adds one
button) and `s3.ts`. They can be built in parallel worktrees; the coordinator makes the
frozen-file edits first (D1, D2's guards, and B's `batch` purpose) so the tracks do not
collide.

## Tasks

Every task is built test first and gets one commit. "Checks" means `npm run lint`,
`npm run typecheck` and `npm test`. Sizes: S = 1–2 files, M = 3–5 files.

### Phase 1: Foundations (coordinator)

- **D1: Migration F and bin rules** (M)
  - Acceptance: `deleted_at` exists on `course` and `sheet`, null for existing rows;
    the binned-question set follows variants through any number of parents; "due for
    erasing" is true from exactly 30 days; the dialog sentence leaves out zero counts.
  - Verify: checks; the migration test; 100% coverage with `src/lib/bin` added.
  - Files: `src/db/schema.ts`, `src/db/migrations/0005_*.sql` (+ meta, test), `src/lib/bin/rules.ts` (+ test), `vitest.config.mts`

- **B1: Region rules and the `batch` upload purpose** (M)
  - Acceptance: boxes are clamped to the photo and get the margin; regions of one
    question are in reading order and at most 10; a proposal or confirmation naming an
    unknown question, another sheet's question, an unknown photo or a submitted question
    is refused; `/api/uploads/presign` accepts `batch` for the user's own sheet only.
  - Verify: checks; 100% coverage with `src/lib/batch` added; presign route tests.
  - Files: `src/lib/batch/regions.ts` (+ test), `src/lib/storage/keys.ts`, `src/app/api/uploads/presign/route.ts` (+ test), `vitest.config.mts`

**Checkpoint 1:** all checks pass; both tracks can start.

### Phase 2: Delete

- **D2: Bin and restore, and 404 for binned items** (M)
  - Acceptance: `binCourse`, `binSheet`, `restoreCourse`, `restoreSheet` work only for
    the owner; every guard refuses a binned course, sheet, question (variants included),
    attempt and revision session; restoring a course leaves a sheet binned earlier on
    its own in the bin; binning while a job runs does not fail the job.
  - Verify: checks; integration tests of each guard and of restore.
  - Files: `src/db/queries/bin.ts` (+ test), `src/lib/auth/ownership.ts` (+ test)

- **D3: Binned work is hidden and does not count** (M)
  - Acceptance: binned items are absent from the courses list, sheet list, overview,
    history, mistake log and export; mastery, the progress chart and review dates are
    computed without binned attempts and return after Restore; times seen leaves out
    binned sources; retry candidates and existing sessions leave out binned questions
    ("The questions in this session were deleted." when none is left).
  - Verify: checks; a before/bin/restore test in `mastery.test.ts`, `misconceptions.test.ts`, `revision.test.ts`, `history.test.ts`.
  - Files: `src/db/queries/{courses,sheets,history,mastery,misconceptions,revision}.ts` (+ tests)

- **D4: Delete dialogs and Recently deleted** (M)
  - Acceptance: "Delete course" and "Delete sheet" open a dialog with the right counts;
    after deleting, the student lands on the courses list or course page with "Moved to
    Recently deleted."; the bin page lists binned courses and separately binned sheets
    with the erase date and Restore; its link shows only when the bin has something.
  - Verify: checks; action tests; browser check at desktop and 375 px.
  - Files: `src/app/(app)/courses/deleted/page.tsx`, `src/app/(app)/courses/[courseId]/delete-actions.ts`, `src/components/delete-dialog.tsx`, the course and sheet pages, `src/app/(app)/courses/page.tsx`

- **D5: Erase after 30 days** (M)
  - Acceptance: an item binned 30 days ago is erased with its history rows and its own
    files; a file another row still uses is kept; a file outside the user's folder is
    never deleted; running it twice is harmless; a failed file delete is logged and the
    rows are still erased; nothing younger than 30 days is touched.
  - Verify: checks; integration tests with a fake `deleteObject`, including a shared
    photo and a demo copy.
  - Files: `src/db/queries/bin-erase.ts` (+ test), the courses list and bin pages (`after()`)

**Checkpoint 2:** delete, restore and erase work in the browser on a test account.

### Phase 3: Batch working

- **B2: `matchWorking` and the propose action** (M)
  - Acceptance: the wrapper has a schema, a fixture and an invalid-output test; the
    action returns matched regions by question id, unmatched regions and skipped
    questions; it runs inside `withAiUser`; a demo copy without enough calls is refused;
    a failure returns the spec's message and changes nothing.
  - Verify: checks; wrapper and action tests with `AI_FIXTURES`.
  - Files: `src/lib/ai/match-working.ts` (+ test, fixture), `src/lib/pipeline/match-working.ts` (+ test), `src/lib/ai/budget.ts` (+ test), `src/app/(app)/sheets/[sheetId]/batch/actions.ts`

- **B3: Submit the confirmed regions** (M)
  - Acceptance: each matched question gets its crops in order after any existing draft
    content, is submitted and gets a mark; a question with submitted working, another
    sheet's question, a crop key that is not the user's, or more than 10 images is
    refused and nothing is half-saved; the photos are deleted; Cancel deletes them too;
    photos left behind are deleted when the sheet is next opened.
  - Verify: checks; action tests with fake storage.
  - Files: `src/db/queries/batch-working.ts` (+ test), `src/app/(app)/sheets/[sheetId]/batch/actions.ts` (+ test), `src/lib/storage/s3.ts` (+ test)

- **B4: The review screen** (M)
  - Acceptance: the sheet page has "Upload working for several questions"; the review
    screen shows each question with its crops and the unmatched regions; a region can be
    moved to another question, removed, adjusted by its corners, and a new box drawn, by
    mouse and by touch; Submit and mark crops in the browser, uploads and submits.
  - Verify: checks; unit test of `cropImage` geometry; browser check at desktop and 375 px.
  - Files: `src/app/(app)/sheets/[sheetId]/batch/page.tsx`, `src/components/batch/{review,region-editor}.tsx`, `src/lib/image-resize.ts` (+ test), the sheet page

**Checkpoint 3:** two photos for four questions are matched, corrected, submitted and
marked in the browser with recorded AI answers.

### Phase 4: Finish and release

- **D6: End-to-end test of delete** (S): bin a sheet, see it gone and the skill map
  change, restore it, bin a course; 375 px. Files: `tests/e2e/delete.spec.ts`
- **B5: End-to-end test of batch working** (S): upload two generated photos, correct one
  region, submit, see the marks; cancel leaves nothing; 375 px.
  Files: `tests/e2e/batch-working.spec.ts`
- **R1: Release** (each step needs your go-ahead): apply migration F to Neon (it only
  adds two columns); `npm run e2e`, full checks and `npm run build`; push `main`; check
  both features on the live site. Rollback: revert the commits; the columns can stay.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A query is missed and still shows or counts binned work | High | The guards give the 404; D3 has one before/bin/restore test per query file; D6 checks the pages |
| Erase deletes a file still in use, or a demo student's file | High | Delete only paths under the user's folder that no remaining row uses; tests for a shared photo and a demo copy |
| The AI's boxes are off, cutting working | Medium | The student always reviews; boxes can be adjusted; crops get a margin |
| Touch editing of boxes is fiddly at 375 px | Medium | Large corner handles; B4's browser check on a phone-sized screen before B5 |
| Ten photos in one AI call is slow or too large | Medium | Photos are resized to 2000 px as today; B2 measures a 10-photo call; lower the limit only with your go-ahead |
| Two tracks edit the same file | Low | Frozen-file edits are done first by the coordinator; the sheet page gets one button from each track, merged by hand |

## Open questions

- None blocking. If you want a different limit than 10 photos or 30 days, say so before
  D1 and B1.
