# Implementation Plan: Marking v2

Source spec: [SPEC-marking-v2.md](../../SPEC-marking-v2.md) (approved 14 November 2026)
Task list: [marking-v2-todo.md](marking-v2-todo.md)
Previous plan (V1, finished): [v1-plan.md](v1-plan.md), [v1-todo.md](v1-todo.md)

Status: **proposed, not approved.** No code for this plan exists yet (an earlier start was
discarded at your request). Building starts only when you approve this plan, and the release
task (P9), which changes the live database and redeploys the site, needs a second go-ahead.

## Overview

Marks become out of 5 with a published scheme; careless slips cost less than structural
errors; 4–5 counts as correct. The mark screen boxes every mistake in the student's own
working (red structural, amber careless) with a hint beside each box that never gives the
correction, and a retry starts from a copy of the previous working. All maths in marker output
is LaTeX inside `$…$`. Two V1 items are carried over: the rest of the live run-through and
demo preparation.

## What the code looks like today (from reading it)

| Area | Where | Today |
|---|---|---|
| Score to outcome | `src/lib/marking/rules.ts` | 0–100; full ≥ 90, partial ≥ 25 |
| Mastery evidence | `src/lib/mastery/evidence.ts`, `src/db/queries/mastery.ts` | full 1.0, partial 0.5, stuck 0 |
| Marker | `src/lib/ai/mark-attempt.ts`, fixture `tests/fixtures/ai/markAttempt.json` | score 0–100, one error type, one quote; feedback may give the correction (the fixture does) |
| Saving a mark | `src/lib/pipeline/mark.ts` (used by first marks, disputes and official re-marks) | one row per mark |
| Score shown | mark page (`/100` twice), solutions review (`/100` twice), attempt card (`%`), history average (rounded integer) | 0–100 |
| Retry | `retryNowAction`, `retryWithNextHintAction` → `startAttemptFor` | new attempt, empty working |
| Removing a draft file | `removeWorkingFileAction` | deletes the stored object |
| Tests on the old scale | `rules`, `mark` pipeline, `marking`, `history`, summary, AI client, both end-to-end specs | assert 0–100 |
| Live data | Neon | 104 marks out of 100; error_type enum has 5 values; no `mistakes` column |

## Architecture decisions

1. **One marker for every kind of mark.** First marks, disputes and official re-marks all go
   through `performMark`, so changing the marker and the pipeline once covers all three.
2. **Mistakes stored as one JSON column on `mark`** (`mistakes`, null for old marks), each with
   type, quote, hint and location. Severity is never stored: it is derived from the type by
   `severityOf`, so the careless/structural split can change without touching data.
3. **LaTeX is enforced, not hoped for.** A pure check, `mathIsDelimited(text)`, rejects text with
   LaTeX commands, `^{` or `_{` outside `$…$`. It is part of the marker's Zod schema, so an
   offending reply is sent back once with the reason (the existing retry in `callAi`), and a
   second failure marks the submission failed (retry button), never a broken screen.
4. **Two migrations, applied at different times.**
   - **A (additive):** two new error-type values and the `mistakes` column. Old code ignores
     both, so it can be applied whenever P9 begins.
   - **B (conversion):** converts the old marks to 0–5 and recomputes their outcomes, only where
     `mistakes IS NULL` (marks from the new marker always have a list), then adds a check that
     scores stay 0–5. Applied right after the new code is live, so the old code never meets the
     check; for that minute old marks briefly show their old number over 5.
5. **Boxes are drawn by the browser, not baked into images.** Photos stay untouched in storage;
   the mark page lays boxes over the image with positions as fractions, so they scale with the
   screen. Typed working is shown with the quoted text wrapped in a box, found by a tested pure
   function; a quote that cannot be found falls back to the list under the working.
6. **Copied files are shared, never duplicated.** A retry's draft points at the same stored
   files. Removing a file from a draft deletes the stored object only if no other submission
   still uses it.

## Dependency graph

```
P1 rules, labels, LaTeX check ──┐
P2 migrations A and B (tested) ─┴─► P3 marker and pipeline ─► P4 mark screen: score, scheme, mistake list
                                                                ├─► P5 boxes on typed text
                                                                └─► P6 boxes on photos, list for PDFs
                                     P1 ─► P7 0–5 everywhere else (review, history, cards)
                                     P2 ─► P8 retry copies the working
                                     all ─► P9 tests and end-to-end ─► P10 release (your go-ahead)
                                                                        └─► C1 live run-through, C2 demo prep
```

P5 and P6 both change the mark page, so they run one after the other. P7 and P8 touch other
files and could run in parallel sessions after P3 if you want speed; the estimate assumes one
agent working in order.

## Phases, estimates and checkpoints

| Phase | Tasks | Estimate | Checkpoint |
|---|---|---|---|
| 1 Foundation | P1, P2 | 40 min | Rules and both migrations pass on the in-memory database; nothing touches Neon |
| 2 Marking and the mark screen | P3, P4, P5, P6 | 2 h | Real-API marks of a typed answer and your 1(a) photo look right in the browser |
| 3 Everything else | P7, P8, P9 | 1 h 15 min | Lint, types, all unit tests and all end-to-end tests pass |
| 4 Release | P10 (needs your go-ahead) | 20 min | Live site on the new marking; converted marks spot-checked |
| Carried over | C1, C2 | you | Remaining live checks; demo ready |

About 4 hours of building in total. It is longer than the spec's 3.5 hours because of the LaTeX check, the shared-file safety and the test updates found while reading the code.

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| The AI applies the 0–5 scheme or careless/structural inconsistently | High | Scheme and type definitions in the prompt with short examples; real-API checks on typed and photo answers in P3–P6; disputes still available |
| Hints or feedback still give the correction | High | Prompt rule, fixtures that follow it, contract tests that reject a fixture giving the answer; manual check of real outputs |
| Maths outside `$…$` shows as raw LaTeX | Medium | `mathIsDelimited` in the schema with one retry (decision 3) |
| Boxes on photos sit a line off | Medium | Padding, numbered boxes, a list with the exact quote; label "approximate" |
| Converting live marks goes wrong | High | Backup table before migration B; conversion only where `mistakes IS NULL`; spot-check after; restore script ready |
| Old live code marks during the switch | Low | Migration B runs after the new deploy is live (decision 4) |
| Removing a copied photo deletes the original | High | Reference check before any storage delete (decision 6), with a test |
| Prompt longer, marking slower | Low | Measure in P3; current marks take about 20 s |

## Open questions

None.
