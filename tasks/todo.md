# Task List: Spot the error

Source spec: [SPEC-spot-the-error.md](../SPEC-spot-the-error.md) · Plan: [plan.md](plan.md)

**Nothing here is built yet. Building starts only after you approve the plan; S10 needs a
second go-ahead.**

Every task: test first, then code, one commit with explicit paths. "Checks" = `npm run lint`,
`npm run typecheck`, `npm test`. Sizes: S = 1–2 files, M = 3–5 files.

## Phase 1: Foundation (45 min)

- [x] **S1: Spot-the-error rules** (M)
  - Acceptance: `rankMisconceptions` puts seen-twice-or-more first (most often seen, then most recent), then seen-once (most recent), skips hidden ones and ones outside the chosen topics; `dealQuestions(n, ranked)` deals misconceptions in turn and gives each question 0, 1 or 2 planted errors with about 1 in 5 at zero and 1 in 5 at two (two different misconceptions where possible); `spotOutcome` follows the spec's section 4 for all six line cases; `timesSeen` counts distinct attempts whose current mark has a source; spot evidence is the outcome value at weight 0.25.
  - Verify: checks; `npm test -- --coverage` with `src/lib/spot` added to the 100% folders.
  - Files: `src/lib/spot/rules.ts` (+ test), `src/lib/domain.ts`, `src/lib/mastery/evidence.ts` (+ test), `vitest.config.mts`

- [ ] **S2: Migration C, tested locally only** (S)
  - Acceptance: adds `misconception`, `misconception_source`, `misconception_mark`, `misconception_job`, `spot_item`, `spot_answer`; adds `mode` (default `long_form`) and `question_count` to `revision_session`; makes `target_minutes` nullable. Tested on the in-memory database: existing sessions read as long-form; a spot session saves without minutes; deleting a session deletes its spot items and answers.
  - Verify: checks. **Not applied to Neon in this task.**
  - Files: `src/db/schema.ts`, `src/db/migrations/0003_*.sql` (+ meta), `src/db/migrations.test.ts`

### Checkpoint 1
- [ ] All tests pass; nothing has touched the live database

## Phase 2: Common-errors memory (1 h 30 min)

- [ ] **S3: Grouping mistakes into misconceptions, refreshed after each mark** (M)
  - Acceptance: `groupMisconceptions` (schema, LaTeX check, one retry, fixtures) places numbered mistakes into existing or new misconceptions; `refreshMisconceptions` claims the course, sends only unread marks' mistakes (old marks as type + first wrong step), saves sources, marks them read, ignores unknown ids and numbers, never revives a hidden misconception, and is safe to run twice; `performMark` schedules it after saving a mark; `listMisconceptions` returns visible ones with times seen, topics, last seen and one example quote; `hideMisconception` refuses another user's.
  - Verify: checks; integration tests (first build from old and new marks, a dispute superseding a mark lowers times seen, hidden stays hidden, two runs at once); real-API grouping of your own mistakes read-only from Neon, printed for you to review.
  - Files: `src/lib/ai/group-misconceptions.ts` (+ test, fixtures), `src/lib/pipeline/misconceptions.ts` (+ test), `src/db/queries/misconceptions.ts` (+ test), `src/lib/pipeline/mark.ts`

- [ ] **S4: Revise page: mode switch, common-errors list, "Not me"** (M)
  - Acceptance: the page offers Long-form (unchanged) and Spot the error; spot mode shows optional topics, 5/10/15 questions and the course's list (sentence, times seen, last seen, one rendered example quote, "Not me"); with nothing to plant it explains why and disables start; opening the page starts a refresh when the course has unread marks and says the list is being updated.
  - Verify: checks; browser check on a local database at desktop and 375 px.
  - Files: `src/app/(app)/revise/page.tsx`, `src/components/revision-form.tsx`, `src/components/common-errors.tsx`, `src/app/(app)/revise/actions.ts`

### Checkpoint 2
- [ ] Your real mistakes grouped into misconceptions you agree with; the list and "Not me" work in the browser

## Phase 3: Spot-the-error sessions (2 h 30 min)

- [ ] **S5: Writing flawed solutions and building a session** (M)
  - Acceptance: `writeFlawedSolution` (schema, LaTeX check on body, lines and planted text, one retry, fixtures) returns a question, numbered lines and 0–2 planted errors on given lines with what is wrong and the correct line; `buildSpotSession` deals questions with S1's rules, writes them 5 at a time, drops a question that fails twice, is ready with at least one question, fails (retry button) with none, and is safe to run twice; the start action creates a spot session.
  - Verify: checks; integration tests with a fake AI; one real-API session of 5 on a local database, reviewed by you.
  - Files: `src/lib/ai/write-flawed-solution.ts` (+ test, fixtures), `src/lib/pipeline/spot-session.ts` (+ test), `src/db/queries/revision.ts`, `src/app/(app)/revise/actions.ts`

- [ ] **S6: Answering and judging** (M)
  - Acceptance: the spot question page shows the question and numbered lines (maths rendered); the student ticks lines with an explanation each (1–500 characters) or presses "No error"; `judgeSpotAnswer` (schema, fixtures) judges only ticked planted lines; the outcome comes from `spotOutcome`; one answer per question (a second submit changes nothing); time spent is recorded; another user's item is a 404.
  - Verify: checks; integration tests for the save and the one-answer rule; real-API judging of a right, a wrong and a reworded explanation.
  - Files: `src/lib/ai/judge-spot-answer.ts` (+ test, fixtures), `src/db/queries/spot.ts` (+ test), `src/app/(app)/revise/[sessionId]/spot/[position]/page.tsx`, `src/components/spot-answer-form.tsx`

- [ ] **S7: Reveal and session summary** (S)
  - Acceptance: after answering, each planted error shows its line highlighted, what is wrong, the correct line and "Based on your common error: …"; wrongly ticked lines say "this line was correct"; each explanation shows the AI's verdict; "Next" moves on; the session page for a spot session lists its questions with outcomes and ends with a summary (counts and missed misconceptions); a long-form session page is unchanged.
  - Verify: checks; browser check at desktop and 375 px.
  - Files: `src/components/spot-reveal.tsx`, `src/app/(app)/revise/[sessionId]/page.tsx`, the spot question page

- [ ] **S8: Mastery at weight 0.25 and the progress chart** (S)
  - Acceptance: answered spot items count on their topics at weight 0.25 with no hint or time factor; long-form mastery values are unchanged for a course with no spot answers; the progress chart labels spot sessions "Spot the error, N questions".
  - Verify: checks; integration tests in `mastery.test.ts`.
  - Files: `src/db/queries/mastery.ts` (+ test), `src/lib/mastery/mastery.ts` (+ test)

### Checkpoint 3
- [ ] A real-API spot session on a local database: natural planted errors, correct other lines, fair judging, full reveal, mastery moves

## Phase 4: Finish (30 min)

- [ ] **S9: End-to-end tests and build** (S)
  - Acceptance: a new end-to-end spec: mark an answer, see the common-errors list, start a 5-question spot session, answer one with ticked lines and one with "No error", see the reveal and the summary, confirm the skill map changed; existing specs still pass; every new screen fits 375 px.
  - Verify: `npm run e2e` (local Postgres until migration C is on Neon); full checks; `npm run build`.
  - Files: `tests/e2e/spot-the-error.spec.ts`, `tests/e2e/helpers.ts`

### Checkpoint 4
- [ ] Lint, types, every unit and end-to-end test pass; build succeeds; ready for your go-ahead

## Phase 5: Release (needs your go-ahead)

- [ ] **S10: Migrate, deploy, build your list, verify** (S)
  - Steps: apply migration C to Neon (additive; old code ignores it); push `main` (redeploys); open Revise on the live site so your list is built from your marks; run one live spot session.
  - Rollback: revert the release commits; the new tables can stay (unused) or be dropped.
  - Verify: existing long-form sessions still open; your list looks right; a live session works end to end.

## Carried over

- [ ] **C1: Finish the live run-through** (you): a dispute, a revision session, and the hand-in export with a photo, on the live site.
- [ ] **C2: Demo preparation** (you): a demo account with a sheet already uploaded and marked; rotate the Anthropic key and delete the old one once the new one works.
