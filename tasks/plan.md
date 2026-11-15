# Implementation Plan: Spaced review of topics (Anki-style)

Source spec: [SPEC-spaced-review.md](../SPEC-spaced-review.md) (approved 15 November 2026)
Task list: [todo.md](todo.md)
Deferred: [SPEC-delete.md](../SPEC-delete.md) (approved, not planned yet)
Previous plans (finished): [archive/spot-the-error-plan.md](archive/spot-the-error-plan.md),
[archive/marking-v2-plan.md](archive/marking-v2-plan.md), [archive/v1-plan.md](archive/v1-plan.md)

Status: **approved 15 November 2026.** No database migration is needed. The release (F2)
is a push and needs your go-ahead.

## Overview

Each topic the student has practised gets an SM-2 review schedule, computed from their
marks each time it is read. Focus next shows when each topic is due and lists due topics
first. Revision sessions pick retry questions whose topics are due, which replaces the
1, 3, 7, 14-day rule for each question.

## What the code looks like today (from reading it)

| Area | Where | Today |
|---|---|---|
| Mastery input | `getCourseMastery` in `src/db/queries/mastery.ts` builds `byTopic: MarkedAttempt[]` (current long-form marks and judged spot answers) | This is exactly the review list: no new queries |
| Slow rule | Inline in `evidenceScore` (`src/lib/mastery/evidence.ts`) | To be exported as `isSlow` |
| Old ladder | `intervalDays`, `isDue` in `src/lib/mastery/queue.ts` (`consecutiveFull`) | Replaced by "one of its topics is due" |
| Revision build | `src/lib/pipeline/revision.ts:78` calls `getCourseMastery`, then `buildQueue` | It will pass the due topic ids |
| Focus next | `focusTopics` (`src/lib/insights/insights.ts`), `FocusNext` (`src/components/insights/focus-next.tsx`) | Ranks by priority, no dates |

## Architecture decisions

1. **The rules live in a pure module, `src/lib/spaced/review.ts`, with 100% line
   coverage.** It exports `gradeOf`, `londonDay`, `collapseByDay` and `replaySchedule`.
   The folder is added to the coverage rule in `vitest.config.mts`.
2. **The schedule is computed on read, like mastery.** `getCourseMastery` adds `review` to
   each topic from its existing `byTopic` list. Nothing is stored.
3. **Revision uses due topics.** `buildQueue` gets `dueTopicIds`. `intervalDays`, `isDue`
   and `Candidate.consecutiveFull` are removed.

## Dependency graph

```
R1 pure schedule rules ─┬─► R2 getCourseMastery.review + Focus next
                        └─► R3 revision uses due topics
R2 + R3 ─► F1 end-to-end test + build ─► F2 release (your go-ahead: push only)
```

## Phases and checkpoints

| Phase | Tasks | Estimate | Checkpoint |
|---|---|---|---|
| 1 Rules | R1 | 1 h | Rules at 100% coverage |
| 2 Using the schedule | R2, R3 | 1 h 30 min | Focus next and revision follow the schedule |
| 3 Finish | F1, F2 | 30 min | All tests and the build pass; live site checked |

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Day boundary bugs around BST | Medium | `londonDay` uses `Intl.DateTimeFormat`, with tests on both sides of the clock change |
| Revision behaviour changes for current users | Medium | Only the "due" signal changes; the existing queue tests are adapted, not deleted |
| Many topics due at once after release | Low | Expected under SM-2; the panel shows three, with a count line |
| Rounding drift in intervals | Low | One rounding rule, tested in the replay sequence |

## Open questions

None.
