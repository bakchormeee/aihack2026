# Implementation Plan: Spot the error

Source spec: [SPEC-spot-the-error.md](../SPEC-spot-the-error.md) (approved 14 November 2026)
Task list: [todo.md](todo.md)
Previous plans (finished): [archive/marking-v2-plan.md](archive/marking-v2-plan.md),
[archive/v1-plan.md](archive/v1-plan.md)

Status: **proposed, not approved.** Building starts only when you approve this plan. The
release task (S10), which changes the live database and redeploys, needs a second go-ahead.

## Overview

Each course gets a memory of the student's common errors (misconceptions), built by the AI
from the mistakes in their marks and refreshed after every new mark. A new revision mode,
Spot the error, writes fresh questions whose worked solutions contain zero to two of those
misconceptions; the student ticks the wrong lines and explains them, the AI judges the
explanations, code judges the lines, and the result counts towards mastery at weight 0.25.

## What the code looks like today (from reading it)

| Area | Where | Today |
|---|---|---|
| Mistakes on marks | `mark.mistakes` (JSON, null for old marks), `mark.error_type`, `mark.first_wrong_step` | Saved by `performMark` in `src/lib/pipeline/mark.ts` for first marks, disputes and official re-marks |
| Revision session | `revision_session` (target_minutes NOT NULL), `revision_item` (question_id, source retry/variant) | Long-form only |
| Starting a session | `src/app/(app)/revise/page.tsx`, `src/components/revision-form.tsx`, `revise/actions.ts` | Course, topics, 20/45/90 min; built in `after()` by `buildRevisionSession` |
| Session page | `src/app/(app)/revise/[sessionId]/page.tsx` | Lists items, each linking to `/questions/…?session=` |
| Background AI jobs | variants via `mapLimit(…, 5)`; claim by conditional UPDATE; stale after 3 min | Pattern to copy |
| Mastery | `getCourseMastery` replays `MarkedAttempt`s through `replayMastery`; weight 1 official / 0.5 provisional | Computed on read, nothing stored |
| Progress chart events | `getCourseEvents` labels sessions "Revision, N min" | Needs a label for the new mode |
| AI calls | `callAi` with Zod schema, one retry, fixtures in `tests/fixtures/ai/<callName>.json` when `AI_FIXTURES=1` | Pattern to copy |
| Coverage rule | 100% lines on `src/lib/marking`, `src/lib/mastery` (`vitest.config.mts`) | Add `src/lib/spot` |

## Architecture decisions

1. **Pure rules in a new folder `src/lib/spot/`, fully covered.** Choosing misconceptions
   (twice-else-once, dealt in turn, topic filter), the 0/1/2-error mix, judging the lines
   and the outcome, and times-seen counting are pure functions with 100% coverage, like
   marking and mastery.
2. **Misconceptions are stored; times seen is computed on read.** Tables:
   - `misconception` (id, user_id, course_id, description, error_type, created_at,
     hidden_at nullable);
   - `misconception_source` (misconception_id, mark_id, mistake_index, attempt_id, topic_ids,
     quote) — one row per mistake placed in a misconception;
   - `misconception_mark` (mark_id primary key, user_id, course_id, processed_at) — which
     marks have been read, so the refresh job only sends new mistakes;
   - `misconception_job` (user_id, course_id primary key, status, status_updated_at) — the
     claim for the course's refresh job.
   Times seen = distinct attempts whose **current** mark has a source in the misconception,
   so a superseded mark (after a dispute or official re-mark) stops counting without any
   deletes. Topics and last seen come from the sources.
3. **One refresh job per course, claimed like marking.** After `performMark` saves a mark,
   it schedules `refreshMisconceptions(userId, courseId)` in `after()`. The Revise page does
   the same when the course has unread marks (this also builds the first list from the 104
   existing marks). The job claims the course row (conditional UPDATE, stale after 3 min),
   reads unread marks in batches of up to 40 mistakes, calls the AI with the current list
   (hidden ones included, marked hidden, so matching mistakes go to them and do not bring
   them back), applies the answer, and records the marks as read. Running twice is safe.
4. **The AI refers to mistakes by number, never by id.** `groupMisconceptions` receives the
   new mistakes numbered 1…n and the existing misconceptions with short ids; it returns, per
   mistake number, an existing id or a new key with a description. Unknown ids and numbers
   out of range are ignored (the mistake stays unread and is retried once, then dropped and
   logged), so a fixture can be static.
5. **Spot sessions reuse `revision_session` with a mode; questions live in their own
   tables.** `revision_session` gains `mode` (`long_form` default | `spot_error`) and
   `question_count`; `target_minutes` becomes nullable. New tables `spot_item` (id,
   session_id, position, body, lines JSON, planted JSON, topic_ids, misconception_ids) and
   `spot_answer` (item_id primary key, user_id, started_at, answered_at, seconds_spent,
   no_error, ticked JSON of {line, explanation}, judgements JSON, outcome). Spot questions are
   never `question` rows, so sheets, history, the mistake log and the hand-in export cannot
   show them (assumption 3).
6. **Lines are judged in code, explanations by the AI.** `judgeSpotAnswer` sees only the
   ticked lines that have a planted error, with the planted error and the student's
   explanation, and returns right/wrong plus one sentence each. The outcome is computed by
   the pure `spotOutcome` from the line sets and those verdicts.
7. **Mastery reads spot answers as a second kind of evidence.** `MarkedAttempt` gains a
   `kind` (`attempt` | `spot`); spot evidence is the outcome value with no hint multiplier
   or time factor, at weight 0.25. `getCourseMastery` adds one row per answered spot item
   per topic. Long-form evidence is unchanged.
8. **Migration C is additive and old code ignores it,** so it can be applied to Neon before
   the push, as migration A was. The only change to an existing column is dropping NOT NULL
   from `target_minutes`, which old code never writes as null.

## Dependency graph

```
S1 pure rules (src/lib/spot) ─────────────────────────────┐
S2 migration C (tables, mode) ─┬─► S3 memory: AI grouping + refresh job + hook
                               │        └─► S4 Revise page: mode switch, common errors, Not me
                               │                 └─► S5 writeFlawedSolution + session builder + start
                               │                          └─► S6 answer: tick, explain, judge, save
                               │                                   └─► S7 reveal + session summary
S1 + S2 ───────────────────────┴─► S8 mastery at 0.25 + progress chart label
all ─► S9 end-to-end + build ─► S10 release (your go-ahead) ─► C1, C2 (yours)
```

S8 only needs S1, S2 and the `spot_answer` table, so it can run alongside S5–S7 in a second
session if you want speed; the estimate assumes one agent in order.

## Phases, estimates and checkpoints

| Phase | Tasks | Estimate | Checkpoint |
|---|---|---|---|
| 1 Foundation | S1, S2 | 45 min | Rules at 100% coverage; migration C passes on the in-memory database; nothing touches Neon |
| 2 Common-errors memory | S3, S4 | 1 h 30 min | Your real mistakes (read-only from Neon) grouped by the real API into sensible misconceptions; Revise page shows the list and "Not me" |
| 3 Spot-the-error sessions | S5, S6, S7, S8 | 2 h 30 min | A real-API session on a local database: natural planted errors, correct other lines, correct judging, reveal and mastery change |
| 4 Finish | S9 | 30 min | Lint, types, all unit and end-to-end tests, build |
| 5 Release | S10 (your go-ahead) | 20 min | Live site offers Spot the error; your list built from your marks |

About 5 h 15 min of building.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Grouping drifts: duplicates, or unrelated mistakes merged | High | Existing list always sent; prompt says reuse before creating; misconceptions must be specific (one sentence with an example); "Not me" as the student's correction; real-API check on your marks in S3 |
| Planted error is unnatural, or the rest of the solution has an unplanned error | High | Prompt: solve first, then plant; schema requires each planted line to differ from its correct version; real-API review of a session in S5; a bad question only costs one item |
| AI judges an explanation too strictly or too loosely | Medium | Judge sees the planted error and the correct line; prompt accepts a correct correction in other words; real-API check in S6 |
| Session build is slow (10–15 questions × 20–40 s) | Medium | Parallel writing (5 at a time, as variants); session page shows progress; `maxDuration` 300 s |
| Refresh jobs race after several marks at once | Medium | One claimed job per course; a mark arriving mid-run is picked up by the next run (unread marks are re-checked before the job ends) |
| Old marks give weak mistakes (only a first wrong step) | Low | Sent with their error type; the AI may leave a mistake unplaced if it is too vague |
| Cost of grouping after every mark | Low | Only new mistakes are sent, batched; one small call per mark |
| Times seen wrong after disputes or re-marks | Medium | Counted on read from current marks only (decision 2), with tests for a superseded mark |

## Open questions

None.
