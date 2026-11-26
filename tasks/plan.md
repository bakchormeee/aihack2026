# Implementation Plan: Study views (topics, attempted-only scores, marks in place, AI marking switch, PDFs in batch)

Source spec: [SPEC-study-views.md](../SPEC-study-views.md) · Tasks: [todo.md](todo.md) ·
Previous plan: [archive/delete-batch-plan.md](archive/delete-batch-plan.md)

## Overview

Seven modules from the spec, built as 14 tasks in five phases. Each task is one vertical slice
that leaves the app working and the e2e tests green:

| Module | Tasks |
|---|---|
| `course-default-tab` | T1 |
| `topic-list` | T2, T3 |
| `question-marks` | T4 |
| `attempted-score` | T5, T6 |
| `mark-in-place` | T7, T8, T9 |
| `mark-on-official` | F1, T10, T11, T12 |
| `batch-pdf` | T13, T14 |

## What the code looks like today (from reading it)

| Area | Where | Today |
|---|---|---|
| Course tabs | `courses/[courseId]/layout.tsx` (TabNav), `page.tsx` | The base address is the skill map: TopicPanel, FocusNext, the selected-topic actions, and the Delete course dialog |
| Skill map | `components/charts/skill-map.tsx`, `skill-map-3d.ts`, `skill-map-layout.ts` (+ test), `components/topic-panel.tsx`, `app/dev/charts/skill-map/` | `d3` and `@types/d3` are used only by `skill-map-layout.ts` |
| Mastery | `lib/mastery/mastery.ts` (`replayMastery`), `evidence.ts`, `db/queries/mastery.ts` (`getCourseMastery`) | Unchanged by this plan; only the display changes |
| Progress chart | `components/charts/mastery-over-time.tsx` + `-model.ts`, `progress-chart.tsx` | A 0–100% axis and a "▲ +N pts" readout |
| Sheet stats | `db/queries/history.ts`: `sheetStats`, `getCourseSheetOverview`, `getSheetHistory`, `AttemptRecord` (`current`: official beats AI) | Average of best scores; Submitted x / total |
| Summary | `history.ts`: `getSheetSummaryInput` (needs every question marked), `summaryIsStale`; `sheets/[sheetId]/summary/page.tsx`, `generate.ts` | Written only when the whole sheet is marked |
| Questions tab | `sheets/[sheetId]/page.tsx` | Rows show time, `HINTS_LABEL` and topics; no attempt status |
| Question page | `questions/[questionId]/page.tsx`, `components/question-view.tsx` | "Your working has been submitted" + **See the mark** link |
| Mark screen | `questions/[questionId]/mark/page.tsx` (340 lines): `getMarkScreenData`, `PhotoWithBoxes`, `WorkingWithBoxes`, `MistakeList`, `MarkingScheme`, `SolutionPanel`, dispute form, "All marks for this attempt" | Its own page |
| Solutions shown | `getVisibleSolution` (`db/queries/marking.ts`): official ?? AI; used by the question, mark and solutions pages, `side-by-side.tsx`, `solution-panel.tsx` | No label says which one it is |
| Submitting | `submitWorkingAction` (question), `submitAllAction` (sheet), `submitBatchAction` (batch), the re-mark action (`mark/actions.ts`) | All claim a mark with `basis: "ai"`, even when an official solution exists |
| Re-marking | `lib/pipeline/remark.ts` after an official upload; `lib/pipeline/mark.ts` (`claimMark`, `performMark`) | Re-marks submitted attempts with basis official |
| Mark status | `MARK_STATUSES` in `lib/domain.ts` → pgEnum `mark_status`; `sheets.timerEnabled` beside it | none, pending, done, failed |
| Batch upload | `components/batch/review.tsx` (images only), `region-editor.tsx`, `lib/image-resize.ts` (resize, `cropImage`) | Up to 10 photos |
| UI kit | `components/ui/` | No Tooltip and no Switch yet (Base UI has both) |

## Architecture decisions

1. **Pure rules, fully covered.** New pure functions go in folders under the 100% coverage rule
   (`vitest.config.mts`):
   - `masteryBand(mastery, attempts)` and the cut-offs in `src/lib/mastery/band.ts`;
   - `questionNumber(label)`, `numberedQuestionMarks(parts)`, `sheetScore(...)` and
     `questionStatus(...)` in a new `src/lib/scores/` (added to the coverage list in F1);
   - `markingPlan({ hasOfficial, markWithAi })` → `"official" | "ai" | "wait"` in
     `src/lib/marking/plan.ts`.
2. **One "mark of a question" rule.** A query helper returns, per question, the latest
   submitted attempt and its current mark (official beats AI, as `AttemptRecord.current`
   does today) plus the number of submitted attempts. The Questions tab, the scores, the
   Summary and the question page all read it. It extends `history.ts`; it does not add a
   second definition.
3. **The mark screen becomes a component.** The body of `mark/page.tsx` moves to
   `src/components/attempt-evaluation.tsx` (server component, data from
   `getMarkScreenData`), rendered by the question page for the selected attempt. `/mark`
   becomes a redirect to `/questions/<id>?attempt=<id>` (keeping `session=`). Moving first and
   restyling second (T7 then T9) keeps each diff reviewable.
4. **One switch, one decision.** Every submit path calls `markingPlan` and then either claims
   the mark with that basis or sets `awaiting_official`. The plan is computed on the server
   from the database (has an official solution?), never trusted from the form; the form only
   sends the switch position, which is also saved on the sheet.
5. **Migration 0006 (F1, ask first, approved in the spec's boundaries)** adds the enum value
   `awaiting_official` to `mark_status` and `sheets.mark_with_ai boolean not null default
   true`. `ALTER TYPE … ADD VALUE` cannot be used in the same transaction that adds it, so the
   migration only adds it; code uses it from the next statement on.
6. **PDF pages become photos in the browser.** `pdfjs-dist` (ask first) renders each page to a
   JPEG with the same size limit as `resizeImage`; from then on the batch flow sees photos
   only. The renderer and its worker are loaded with a dynamic `import()` on the batch page
   only, so no other page's bundle grows.
7. **Tooltip and Switch** come from shadcn's Base UI registry (`npx shadcn add tooltip
   switch`), done by the coordinator in F1 so tracks don't both add them.

## Dependency graph

```
T1 default tab ─► T2 topic list ─► T3 bands, delete skill map
T4 question marks ─► T5 sheet score ─► T6 summary
        └─► T7 mark on the question page ─► T8 timeline ─► T9 working by type, official wins
F1 migration + kit ─► T10 marking plan on submit ─► T11 official upload marks waiting ─► T12 switch UI
T13 PDF renderer ─► T14 batch accepts a PDF
T12 needs T4 (pill), T7 (waiting state on the question page) and T14 (both edit batch/review.tsx)
```

## Tasks

Every task is built test first and gets one commit with its id. "Checks" means `npm run lint`,
`npm run typecheck`, `npm test` (then `git checkout -- tsconfig.json`). A task that changes a
screen also gets a browser check at desktop width and 375 px on a test account. A task that
breaks an existing e2e test fixes that test in the same commit. Sizes: S = 1–2 files,
M = 3–5 files, L = more (split if it grows).

### Phase 1: Foundations (coordinator)

- **F1: Migration 0006, coverage list, Tooltip and Switch** (M)
  - Acceptance: `awaiting_official` is a mark status in `MARK_STATUSES` and the enum; sheets
    have `mark_with_ai`, true for existing rows; every exhaustive use of the mark status
    type-checks (the new value is treated as "not marked" where it is read); `src/lib/scores`
    is in the coverage list; `components/ui/tooltip.tsx` and `switch.tsx` exist.
  - Verify: checks; the migration test (vitest applies all migrations to its in-memory
    Postgres); `npm run db:generate` produces no further diff.
  - Files: `src/lib/domain.ts`, `src/db/schema.ts`, `src/db/migrations/0006_*.sql` (+ meta),
    `vitest.config.mts`, `src/components/ui/{tooltip,switch}.tsx`

**Checkpoint 1:** checks pass; the tracks can start.

### Phase 2: Course screens (`course-default-tab`, `topic-list`)

- **T1: Sheets is the default course tab** (M)
  - Acceptance: `/courses/<id>` shows the sheet list, upload form, empty state and Delete
    course; `/courses/<id>/sheets` shows the same with the Sheets tab selected; tabs read
    Sheets, Topics, Mistakes, Progress; `/courses/<id>/topics` shows today's skill map
    unchanged (moved, restyled in T2).
  - Verify: checks; e2e `delete.spec.ts` and `full-flow.spec.ts` updated and passing.
  - Files: `courses/[courseId]/{layout,page}.tsx`, `sheets/page.tsx`, `topics/page.tsx` (new),
    `components/tab-nav.tsx` (if one tab must match two addresses), the two e2e files

- **T2: Topics list with word labels** (M)
  - Acceptance: `masteryBand` gives the four labels by the spec's table, tested at 0.4499,
    0.45, 0.70, 0.7001 and for 0, 2 and 3 attempts; the list is weakest first, unmarked topics
    last by name; each label has a tooltip "Mastery N% · K attempts" on hover and focus;
    opening a row shows that line, "Needs: …" and Revise / Spot the error / See mistakes, and
    closes any other row; the legend line is under the list; no percentage on a line.
  - Verify: checks; component test of open/close and the tooltip text; browser check
    (keyboard: Tab to a row, Enter opens; touch width shows the line in the open row).
  - Files: `src/lib/mastery/band.ts` (+ test), `src/components/topic-list.tsx` (+ test),
    `courses/[courseId]/topics/page.tsx`

- **T3: Progress bands; skill map and Focus next deleted** (M, after T2)
  - Acceptance: the Progress chart shows three shaded bands labelled Needs work, Getting
    there, Solid (cut-offs from `band.ts`), no % axis and no "pts" readout; the skill map
    files, `topic-panel.tsx`, `focus-next.tsx`, the dev page and `d3` / `@types/d3` are gone;
    `npm run build` passes; mastery values are unchanged (existing mastery tests pass as is).
  - Verify: checks; build; the e2e skill-map test becomes "the topics list leads to a
    revision session"; phone-width URL list says "topics".
  - Files: `charts/mastery-over-time{,-model}.tsx/ts` (+ test), deletions, `package.json` +
    lockfile (coordinator), `tests/e2e/full-flow.spec.ts`

**Checkpoint 2:** the course opens on Sheets; the Topics tab and Progress chart work in the
browser; no WebGL on the Topics tab.

### Phase 3: Marks on the sheet (`question-marks`, `attempted-score`)

- **T4: Status of each question on the Questions tab** (M)
  - Acceptance: `questionStatus` returns none, draft, marking, waiting, marked (score,
    outcome word, attempts) or failed, tested for each case including a full outcome below 5
    ("Correct, slips") and several attempts; the mark is the latest submitted attempt's, not
    the best; each row shows it on the right as text (pips decorative); "Hints ready" is gone,
    "Hints being prepared…" and "Hints failed" remain.
  - Verify: checks; query test on the in-memory database with two attempts (latest lower than
    the first); browser check.
  - Files: `src/lib/scores/status.ts` (+ test), `src/db/queries/history.ts` (+ test),
    `sheets/[sheetId]/page.tsx`, `src/components/question-status.tsx`

- **T5: Attempted-only sheet score** (M, after T4)
  - Acceptance: `questionNumber` and `sheetScore` pass the spec's examples (1, 2(a), 2(b),
    3 marking, 4 not started → question 2 is 4/5, score 9 / 10 (90%), "Attempted 2 / 4");
    the Sheets tab row shows *Attempted* and *Score* ("–" when nothing is marked); the line
    "17 / 25 · 68% · attempted 5 of 9 questions" (or "Attempted 0 of 9 questions · no marks
    yet") is above the tabs on every sheet tab.
  - Verify: checks; `sheetStats` test rewritten for the new rule; browser check.
  - Files: `src/lib/scores/score.ts` (+ test), `history.ts` (`sheetStats`), `courses/[courseId]/sheets` list page,
    `sheets/[sheetId]/layout.tsx`, `src/components/sheet-score-line.tsx`

- **T6: Summary from the first mark** (M, after T5)
  - Acceptance: the Summary is generated once one part is marked; it says "Based on
    questions 1, 2(a) and 4"; it is rewritten when a new mark arrives (`summaryIsStale`); the
    score line is at its top; its AI input is still one item per marked part; awaiting and
    marking parts are left out.
  - Verify: checks; `getSheetSummaryInput` and `summaryIsStale` tests with one marked part;
    summary page with recorded AI answers.
  - Files: `history.ts` (+ test), `sheets/[sheetId]/summary/{page,generate}.tsx/ts`

**Checkpoint 3:** a sheet with some parts marked shows the right status per row, the score
above the tabs and a Summary naming those questions.

### Phase 4: The mark on the question page (`mark-in-place`)

- **T7: The evaluation on the question page** (L: a move, then small changes)
  - Acceptance: a question whose latest attempt is submitted shows the evaluation (today's
    mark screen content) under the question with no click; `?attempt=<id>` selects another of
    the user's attempts (a foreign or unknown id is a 404); `/questions/<id>/mark?attempt=…`
    redirects there, keeping `session=`; revision sessions work; the locked hints line
    replaces the hint buttons and timer; waiting-while-marking refreshes by itself.
  - Verify: checks; every e2e "See the mark" click becomes a check on the question page
    (`core-loop`, `batch-working`, `spaced-review`, `spot-the-error`, `full-flow`,
    `demo-db.ts`); `npm run e2e` passes.
  - Files: `src/components/attempt-evaluation.tsx` (moved from `mark/page.tsx`),
    `questions/[questionId]/page.tsx`, `mark/page.tsx` (redirect), `question-view.tsx`, e2e files

- **T8: Attempt timeline** (M, after T7)
  - Acceptance: shown only with more than one submitted attempt; dots oldest → newest,
    coloured by outcome, dated, newest selected; choosing one changes `?attempt=`; arrow keys
    move and Enter chooses; each dot has the accessible name "Attempt 2, 24 November, 2 out
    of 5, partial"; more than 6 collapse into "+N earlier".
  - Verify: checks; component test (keyboard, collapse at 7); browser check at 375 px.
  - Files: `src/components/attempt-timeline.tsx` (+ test), `questions/[questionId]/page.tsx`,
    a query for the attempts list (existing `getSheetHistory` data or a small helper)

- **T9: Working by type; official solutions win** (M, after T8)
  - Acceptance: mistakes are numbered once across typed text (underlines + notes), photos
    (numbered boxes + list; hover/focus highlights both; tap scrolls) and PDF notes ("Page 2");
    unlocated mistakes are listed without a number; the official solution, once present, is
    the one shown everywhere with the label "Official solution", otherwise "AI-written
    solution"; the score line, dots and Questions tab use the official mark once it exists;
    while that re-mark runs the page says "Re-marking against the official solution…".
  - Verify: checks; tests of the numbering helper and of the label on the question,
    solutions and side-by-side views; browser check with a photo attempt.
  - Files: `attempt-evaluation.tsx`, `photo-with-boxes.tsx`, `working-with-boxes.tsx`,
    `mistake-list.tsx` (+ tests), `solution-panel.tsx`

**Checkpoint 4:** on a question with three attempts (typed, photo, PDF), the newest shows on
the page, the oldest can be chosen, and the official solution and mark show after an upload.

### Phase 5: AI marking switch (`mark-on-official`) and PDFs in batch (`batch-pdf`)

- **T10: Every submit follows the marking plan** (M, after F1)
  - Acceptance: `markingPlan` gives official when the question has an official solution
    (whatever the switch), ai when the switch is on, wait when off; the three submit actions
    apply it per question and save the switch position on the sheet; a submission on a
    question with an official solution gets one mark, basis official, and no AI-basis mark
    (the bug fix); with the switch off no AI marking call is made (fake client) and the
    status is `awaiting_official`.
  - Verify: checks; action tests for the three paths × three plans.
  - Files: `src/lib/marking/plan.ts` (+ test), `submit-actions.ts`, `sheets/[sheetId]/actions.ts`,
    `sheets/[sheetId]/batch/actions.ts` (+ their tests)

- **T11: Official upload marks waiting work; Mark with AI instead** (M, after T10)
  - Acceptance: after an official upload, each waiting submission on a question that now has
    an official solution is marked with basis official, alongside today's re-marks; one with
    no official solution keeps waiting; *Mark with AI instead* marks a waiting submission
    with basis ai (counts against the demo budget like any mark); waiting submissions are
    left out of the score, the attempted count, the Summary, mastery and revision.
  - Verify: checks; `remark.ts` test with a mix of waiting and marked submissions; mastery
    and revision query tests with a waiting submission.
  - Files: `src/lib/pipeline/remark.ts` (+ test), `questions/[questionId]/actions.ts` (+ test),
    `src/db/queries/{mastery,revision}.ts` (only if they do not already filter on `done`)

- **T12: The switch on every submit button** (M, after T4, T7, T11 and T14)
  - Acceptance: `MarkWithAiSwitch` (`role="switch"`, Space and Enter) right of each submit
    button, starting at the sheet's last position, with the helper text for its position;
    greyed out with a lock and "Marked against the official solution" when the question has
    one; in the batch, greyed out when all matched questions have one, otherwise "Applies to
    N of M questions" plus a label per question; the question page shows the waiting state
    ("Marked when the official solutions are uploaded." + *Mark with AI instead*).
  - Verify: checks; component test (keyboard, greyed state, text); browser check of all three
    places at 375 px.
  - Files: `src/components/mark-with-ai-switch.tsx` (+ test), `working-input.tsx` or
    `question-view.tsx`, `sheets/[sheetId]/page.tsx`, `components/batch/review.tsx`,
    `attempt-evaluation.tsx`

- **T13: PDF pages to JPEGs** (M, ask first: `pdfjs-dist`)
  - Acceptance: `renderPdfPages(file)` returns one JPEG per page within the photo size limit;
    a PDF of more than 10 pages, a password-protected or an unreadable PDF is refused with the
    spec's message before any upload; the worker loads under Next 16 in dev and in the build;
    the library is only in the batch page's bundle.
  - Verify: checks; unit test of the page-count and error rules (the renderer is passed in);
    build; browser check with a 3-page and an 11-page PDF.
  - Files: `package.json` + lockfile (coordinator), `src/lib/pdf-pages.ts` (+ test),
    `next.config.ts` only if the worker needs it (coordinator)

- **T14: Batch upload accepts one PDF** (M, after T13)
  - Acceptance: the batch dropzone takes one PDF or up to 10 photos, not both; a PDF's pages
    go through matching, review, region editing and cropping exactly like photos; a page with
    no working shows no regions; nothing is sent to `matchWorking` as a PDF.
  - Verify: checks; e2e: a generated 3-page PDF is matched, submitted and marked with recorded
    AI answers; a PDF plus a photo is refused.
  - Files: `components/batch/review.tsx`, `src/lib/storage/limits.ts` (if the accept list
    lives there), `tests/e2e/batch-working.spec.ts`

**Checkpoint 5:** with the switch off, a submission waits, an official upload marks it, and a
3-page PDF goes through the batch upload, in the browser with recorded AI answers.

### Phase 6: Finish and release

- **E1: End-to-end tests for the new screens** (M): three attempts and the timeline; switch off
  → waiting → official upload → marked with the official solution shown; Topics tab row open
  and Revise; sheet score line; all at 375 px. Files: `tests/e2e/study-views.spec.ts` (new),
  fixtures if needed.
- **R1: Release** (each step needs your go-ahead): apply migration 0006 to Neon (adds an enum
  value and a column with a default; existing rows are untouched); full checks, `npm run e2e`
  and the build; push `main`; check the features on the live site; set the spec's Status to
  implemented and fold it into `SPEC.md`. Rollback: revert the commits; the enum value and the
  column can stay (unused values are harmless).

## Running it in parallel (optional)

If tracks run in parallel, follow the rules of [archive/v1-plan.md](archive/v1-plan.md)
("Rules for parallel agents"): one worktree per track on `track/<name>`, own port and
hostname, write only the files of your task, one commit per task, never edit `tasks/` or the
spec, a blocked agent stops and reports, the coordinator merges at checkpoints.

| Track | Tasks | Port |
|---|---|---|
| Coordinator | F1, then merging, R1 | 3000 (`127.0.0.1`) |
| Course | T1, T2, T3 | 3001 |
| Sheet and mark | T4, T5, T6, T7, T8, T9, T10, T11, T12 | 3002 |
| Batch PDF | T13, T14 | 3003 (R2 CORS allows uploads only from 3000 and 3003) |

Shared files force order: `history.ts` (T4 → T5 → T6), `question-view.tsx` and the question
page (T7 → T8 → T9 → T12), the sheet page (T4 → T12), `batch/review.tsx` (T14 → T12). That
is why the second track is one sequence and T12 waits for T14.

**Frozen files** (coordinator only): `SPEC*.md`, `tasks/`, `package.json`, the lockfile,
`next.config.ts`, `vitest.config.mts`, `src/lib/domain.ts`, `src/db/schema.ts`,
`src/db/migrations/`, `src/components/ui/`, `src/lib/auth/`.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| A place that reads the mark status treats `awaiting_official` as marked or as failed | High | F1 makes the type exhaustive; T11 tests mastery, revision, score and Summary with a waiting submission |
| The "latest attempt" rule differs between screens | Medium | One query helper (decision 2); T4, T5 and T9 tests use the same two-attempt fixture |
| T7 is a large move and breaks revision sessions or old links | Medium | Move first with no restyle; redirect keeps `attempt` and `session`; all e2e tests run in T7 |
| `pdfjs-dist` worker does not load under Next 16 / Turbopack | Medium | T13 is first in its track and checks dev and build before T14; fallback: the legacy build without a worker (slower, same output) |
| PDF rendering uses too much memory on a phone | Low | Pages are rendered one at a time at the photo size limit and released |
| Score change confuses: numbers drop or rise against what the owner saw | Low | The attempted count is always shown beside the score |
| Adding an enum value on Neon | Low | Additive only; applied in R1 with your go-ahead; no data rewrite |

## Open questions

- None blocking. Name of the sheet column: `mark_with_ai` (say so before F1 if you want
  another).
