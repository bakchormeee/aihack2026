# Task List: Spaced review of topics

Source spec: [SPEC-spaced-review.md](../SPEC-spaced-review.md) · Plan: [plan.md](plan.md)

Every task is built test first, then code, and gets one commit that names its files.
"Checks" means `npm run lint`, `npm run typecheck` and `npm test`. Sizes: S = 1–2 files,
M = 3–5 files.

## Phase 1: Rules (1 h)

- [ ] **R1: Schedule rules** (M)
  - Acceptance:
    - The grade table in the spec's section 2 holds for long-form attempts and for spot
      answers.
    - Days are UK days, tested on both sides of the clock change.
    - Several reviews of a topic on one day count as one: the worst grade wins, at the
      time of the last one.
    - SM-2 follows section 3 exactly:
      - first intervals of 1, 1, 3 and 4 days;
      - later intervals of ×1.2, ×ease and ×ease×1.3;
      - ease −0.20, −0.15 and +0.15, never below 1.3;
      - each later interval at least one day longer than the last, except after Again;
      - a cap of 365 days, and no bonus for a late review.
    - `isSlow` is exported from `evidence.ts` and used by `evidenceScore`.
  - Verify: checks; a replay test of a known sequence of grades; 100% coverage with
    `src/lib/spaced` added.
  - Files: `src/lib/spaced/review.ts` (+ test), `src/lib/mastery/evidence.ts`, `vitest.config.mts`

### Checkpoint 1
- [ ] Rules at 100% coverage; all checks pass

## Phase 2: Using the schedule (1 h 30 min)

- [ ] **R2: Focus next shows due dates** (M)
  - Acceptance:
    - Each topic from `getCourseMastery` has a `review` (null when untried).
    - Due and overdue topics come first, most overdue first and then weakest. A due topic
      stays even when it is secure. The panel shows three rows.
    - Each row says "Due today", "Overdue by N days", "Next review in N days (18 Nov)" or
      "Not tried yet".
    - The line under the title says "2 topics due for review" or "Nothing due. Next review
      on 18 Nov."
  - Verify: checks; `insights.test.ts`; in `mastery.test.ts`, a dispute changes the
    review; browser check at desktop and 375 px.
  - Files: `src/db/queries/mastery.ts` (+ test), `src/lib/insights/insights.ts` (+ test), `src/components/insights/focus-next.tsx`

- [ ] **R3: Revision follows the topic schedule** (S)
  - Acceptance:
    - `buildQueue({…, dueTopicIds})` ranks a candidate with a due topic first.
    - `intervalDays`, `isDue` and `consecutiveFull` are removed.
    - A retry picked for a due topic has the reason "due for review of *Topic*".
    - The candidate filter, the priority order and the 60/40 split are unchanged.
  - Verify: checks; updated `queue.test.ts` and `revision.test.ts`.
  - Files: `src/lib/mastery/queue.ts` (+ test), `src/lib/pipeline/revision.ts` (+ test), `src/db/queries/revision.ts` (+ test)

### Checkpoint 2
- [ ] Focus next and revision follow the schedule; all checks pass

## Phase 3: Finish (30 min)

- [ ] **F1: End-to-end test and build** (S)
  - Acceptance: a new spec marks an answer and sees "Next review in …" for its topic in
    Focus next. The existing specs still pass, and Focus next fits 375 px.
  - Verify: `npm run e2e`; full checks; `npm run build`.
  - Files: `tests/e2e/spaced-review.spec.ts`

- [ ] **F2: Release** (your go-ahead): push `main`, wait for the deploy, and check the
  live course page. No database change.

## Carried over

- [ ] **Spot the error, live check** (you): run one spot-the-error session on the live site.
- [ ] **C1: Finish the live run-through** (you): a dispute, a revision session, and the hand-in export with a photo, on the live site.
- [ ] **C2: Demo preparation** (you): a demo account with a sheet already uploaded and marked; rotate the Anthropic key and delete the old one once the new one works.
