# Task List: Marking v2

Source spec: [SPEC-marking-v2.md](../SPEC-marking-v2.md) · Plan: [plan.md](plan.md)

**Nothing here is built yet. Building starts only after you approve the plan; P10 needs a
second go-ahead.**

Every task: test first, then code. "Checks" = `npm run lint`, `npm run typecheck`, `npm test`.
Sizes: S = 1–2 files, M = 3–5 files.

## Phase 1: Foundation (40 min)

- [x] **P1: Rules, labels and the LaTeX check** (M)
  - Acceptance: `outcomeFromScore` gives 4–5 full, 2–3 partial, 0–1 stuck and rejects anything but 0–5 whole numbers; `severityOf` makes algebra, arithmetic and notation slips careless and everything else structural; `scoreFromOldScale` follows the spec's table; a 4 counts 0.9 in mastery evidence; one shared list of labels and the marking scheme; `mathIsDelimited` rejects LaTeX outside `$…$`.
  - Verify: checks; `npm test -- --coverage` keeps 100% on `src/lib/marking` and `src/lib/mastery`.
  - Files: `src/lib/domain.ts`, `src/lib/marking/rules.ts` (+ test), `src/lib/mastery/evidence.ts` (+ test), `src/lib/marking/labels.ts`, `src/lib/marking/math-check.ts` (+ test)

- [x] **P2: Migrations A and B, tested locally only** (S)
  - Acceptance: A adds `arithmetic_slip`, `notation` and the `mistakes` column; B converts old-scale marks (only where `mistakes IS NULL`), recomputes outcomes and adds the 0–5 check. Both are tested on the in-memory database with sample old marks: boundary scores convert as specified, a new-style mark is left alone, the check rejects 6.
  - Verify: checks. **Neither migration is applied to Neon in this task.**
  - Files: `src/db/schema.ts`, `src/db/migrations/0001_*.sql`, `src/db/migrations/0002_*.sql` (+ meta), `src/db/migrations.test.ts`

### Checkpoint 1
- [ ] All tests pass; nothing has touched the live database

## Phase 2: Marking and the mark screen (2 h)

- [x] **P3: The new marker, end to end in the pipeline** (M)
  - Acceptance: the marker returns a 0–5 score, an ordered list of mistakes (type, quote, hint, location) and hints-only feedback, with all maths in `$…$`; a reply that fails the schema or the LaTeX check is asked for once more; `performMark` saves the score, the outcome from the new bands, the mistakes, and the first mistake's type; disputes and official re-marks use it unchanged; the mastery query passes the score. Fixtures rewritten in the new shape and hints-only.
  - Verify: checks; contract tests (valid fixture, invalid fixture, a fixture with LaTeX outside `$…$` is rejected, a fixture that states the correction fails a hints-only test); one real-API mark of a typed answer, timed.
  - Files: `src/lib/ai/mark-attempt.ts` (+ test), `tests/fixtures/ai/markAttempt*.json`, `src/lib/pipeline/mark.ts` (+ test), `src/db/queries/mastery.ts`

- [x] **P4: Mark screen shows the score out of 5, the scheme and the mistake list** (S)
  - Acceptance: "4/5" with Correct / Partly right / Stuck; the scheme with the current score highlighted; each mistake numbered with its kind (careless or structural), quote and hint; old marks without a mistake list still show their first wrong step; the all-marks list shows /5.
  - Verify: checks; browser check on a real mark.
  - Files: `src/app/(app)/questions/[questionId]/mark/page.tsx`, `src/components/mistake-list.tsx`

- [x] **P5: Boxes on typed working** (S)
  - Acceptance: the typed working is shown with each quote boxed red or amber and numbered to match the list; a quote not found in the text stays in the list only; maths in the working still renders.
  - Verify: unit tests for finding quotes (exact, extra spaces, not found, overlapping); browser check.
  - Files: `src/lib/marking/locate-quotes.ts` (+ test), `src/components/working-with-boxes.tsx`, mark page

- [x] **P6: Boxes on photos, list for PDFs** (M)
  - Acceptance: each photo is shown with numbered red or amber boxes at the AI's positions (padded, clamped inside the image) and a legend marked "approximate"; PDFs show page number, quote and hint; works at 375 px.
  - Verify: unit tests for box padding and clamping; real-API check on your 1(a) photo; screenshots at desktop and phone width.
  - Files: `src/lib/marking/boxes.ts` (+ test), `src/components/photo-with-boxes.tsx`, mark page

### Checkpoint 2
- [ ] A typed answer and your 1(a) photo, marked with the real API, look right in the browser: score, scheme, boxes, hints that do not give the correction, maths rendered

## Phase 3: Everything else (1 h 15 min)

- [x] **P7: Scores out of 5 everywhere else** (M)
  - Acceptance: solutions review, attempt cards and the sheet list show /5; averages to one decimal ("3.4/5"); the review's ordering still works.
  - Verify: checks with the history, marking and summary tests updated to the new scale.
  - Files: `src/app/(app)/sheets/[sheetId]/solutions/page.tsx`, `src/components/attempt-card.tsx`, `src/db/queries/history.ts` (+ test), `src/db/queries/marking.ts` (+ test)

- [x] **P8: Retry starts from a copy of the previous working** (M)
  - Acceptance: "Retry now" and "Retry with hint N" give a draft with the previous typed text and the same files; the earlier attempt is unchanged; removing a copied file from the draft never deletes a stored object another submission uses; "Try again" from History still starts empty.
  - Verify: integration tests for all four rules.
  - Files: `src/db/queries/attempts.ts` (+ test), `src/db/queries/working.ts` (+ test), `src/app/(app)/questions/[questionId]/submit-actions.ts`

- [x] **P9: End-to-end tests on the new marking** (S)
  - Acceptance: both end-to-end specs pass with the new fixture; added checks: the mark shows /5 and the scheme, a typed mistake is boxed, a retry opens with the previous working.
  - Verify: `npm run e2e`; full checks; `npm run build`.
  - Files: `tests/e2e/core-loop.spec.ts`, `tests/e2e/full-flow.spec.ts`

### Checkpoint 3
- [ ] Lint, types, every unit test and every end-to-end test pass; build succeeds; ready for your go-ahead to release

## Phase 4: Release (needs your go-ahead)

- [ ] **P10: Back up, migrate, deploy, convert, verify** (S)
  - Steps: copy the `mark` table to a backup table; apply migration A; push `main` (redeploys); once the new code is live, apply migration B; spot-check converted marks against the backup; mark one answer on the live site.
  - Rollback: restore scores and outcomes from the backup table and revert the release commits.
  - Verify: no mark above 5; every outcome matches the bands; a live mark shows /5 with boxes.

## Carried over from V1

- [ ] **C1: Finish the live run-through** (you, after P10): a dispute, a revision session, and the hand-in export with a photo, on the live site.
- [ ] **C2: Demo preparation** (you): a demo account with a sheet already uploaded and marked; rotate the Anthropic key and delete the old one once the new one works.
