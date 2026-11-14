# Spec Delta: Marking v2 (marks out of 5, careless vs structural, boxed mistakes)

Status: approved (14 November 2026). Feedback, quotes and hints must write every piece of maths as LaTeX inside $…$, with words as plain text.
Original spec: [SPEC.md](SPEC.md), sections "`marking`", "`mastery`" and "`history`".

## Objective

Make marking fairer and more useful for fixing mistakes:

1. Marks are **out of 5** with a published scheme, and **careless slips cost less than
   structural errors**.
2. An answer with the **right structure and 1–2 careless slips counts as correct**.
3. On the mark screen, **every mistake is boxed in the student's own working**: red for
   structural, amber for careless, with a **hint beside each box** (what to check, never the
   correction), so the student can fix it and resubmit.

## Current behaviour (what changes)

- Score 0–100; outcome full ≥ 90, partial 25–89, stuck < 25 (`src/lib/marking/rules.ts`).
- The marker returns one error type and one "first wrong step" quote; the feedback may state
  the correction.
- Mastery evidence: full 1.0, partial 0.5, stuck 0 (`src/lib/mastery/evidence.ts`).
- A retry starts with empty working.
- 104 marks are stored out of 100.

## New behaviour

### 1. Marking scheme (shown to students on the mark screen)

| Score | Meaning | Outcome |
|---|---|---|
| 5 | Fully correct. | Correct |
| 4 | Right structure, with 1–2 careless slips. | Correct |
| 3 | Right approach, but a structural gap, or 3 or more careless slips. | Partly right |
| 2 | A sound start, then a structural error. | Partly right |
| 1 | Only a relevant idea. | Stuck |
| 0 | Blank, off-topic or for a different question. | Stuck |

Outcome bands: **4–5 correct (full), 2–3 partly right, 0–1 stuck.** These drive the solution
unlock, the "still to get right" review, revision candidates and the mastery outcome, exactly as
`full`/`partial`/`stuck` do today.

### 2. Kinds of mistake

| Error type | Severity | Box colour |
|---|---|---|
| `algebra_slip` (dropped sign, wrong expansion, method right) | careless | amber |
| `arithmetic_slip` (new: wrong arithmetic, copying a number wrongly) | careless | amber |
| `notation` (new: wrong symbol or missing bracket, meaning clear) | careless | amber |
| `conceptual` | structural | red |
| `method` | structural | red |
| `incomplete` | structural | red |
| `misread_question` | structural | red |

Severity is derived from the type by one pure function; the AI only chooses the type.
The mark's existing `error_type` column keeps the type of the **first** mistake.

### 3. What the marker returns

Per mark: `score` (0–5), and a list of **mistakes**, in the order they occur in the working, each with:

- `type` (one of the error types above);
- `quote`: the student's own words or symbols at that step, copied exactly;
- `hint`: what to check, in one or two sentences. It **never** gives the corrected step, the
  correct value or the final answer;
- `location`: for typed working the quote is enough; for a photo, the file's index and a
  rectangle (x, y, width, height as fractions 0–1 of the image); for a PDF, the file index and
  page number.

Plus `feedback` and `overallFeedback`, which follow the same rule: **hints only, never the
correction** (the worked solution still unlocks after a correct mark or all three hints).
The marker must score by the scheme above: careless slips alone cannot lower a correct
structure below 4 unless there are 3 or more.

### 4. Boxes on the mark screen

- **Typed working:** the working is shown with each mistake's quote boxed (red or amber) in place,
  and its hint beside or under the box. The quote is found in the typed text exactly, ignoring
  differences in spaces; if it cannot be found, that mistake is listed below the working instead.
- **Photos:** each photo is shown with its boxes drawn at the AI's estimated position, with some
  padding; the position is approximate and may be a line off. The hint appears beside the box,
  numbered to match it; the list below the photo also shows the quote, so the exact step is clear.
- **PDFs:** no boxes; each mistake is listed with its page number, quote and hint.
- A 4 shows its careless slips in amber, so the student can still fix them.
- A legend explains red = structural, amber = careless.

### 5. Fix and resubmit

"Retry now" and "Retry with hint N" start a new attempt whose draft is a **copy of the previous
working**: the typed text, and the same photos or PDF attached. The student edits and resubmits.
The earlier attempt, its submission and its marks are unchanged. Removing a copied file from the
new draft removes it from that draft only: a stored file still used by another submission is
never deleted. "Try again" from History still starts empty (fresh), as before.

### 6. Mastery

Evidence for one attempt: score 5 → 1.0, score 4 → 0.9, partly right → 0.5, stuck → 0, then
the existing hint multiplier, slow-time factor and provisional weight apply unchanged.

### 7. Existing marks

All 104 stored marks are converted once, by migration: 90–100 → 5, 70–89 → 4, 50–69 → 3,
25–49 → 2, 10–24 → 1, 0–9 → 0; each outcome is recomputed from the new score with the new
bands. Old marks have no mistake list: they show their old "first wrong step" text and no boxes.
`outcome_changed` flags are not recomputed. Some old partly-right marks (70–89) become correct:
accepted.

### 8. Everywhere a score is shown

Mark screen, all-marks list, solutions review, history, sheet list averages: "4/5" instead of
"72/100"; averages to one decimal ("3.4/5").

## Success criteria

1. A typed answer with the right method and one sign slip scores 4, counts as correct, unlocks the
   worked solution, and shows one amber box around the slip with a hint that does not state the
   corrected step.
2. A typed answer with a wrong method scores at most 3 and shows a red box at the first structural
   error.
3. Every mark's feedback, overall comment and box hints contain no corrected step or final answer
   (checked by the prompt rules and by contract tests on recorded answers).
4. On a photo, each mistake has a box drawn on the image and a numbered hint; on a PDF, a page
   number, quote and hint.
5. "Retry now" opens a new attempt with the previous typed text and files already in its draft; the
   earlier attempt is unchanged; removing a copied file never deletes the stored object.
6. Mastery: a 4 moves a topic's mastery less than a 5 and much more than a partly-right answer.
7. After the migration, no mark has a score above 5, and every outcome matches the new bands.
8. **Unchanged:** the hint ladder and its order, the solution lock rules (correct mark or three
   hints), disputes (still at most two), official re-marking, the hand-in export, and ownership
   checks. All existing tests still pass after updating the ones that assert 0–100 scores.

## Boundaries (only the deltas)

- **Never:** put a corrected step, correct value or final answer in a mark's feedback, overall
  comment or box hints; delete a stored file that another submission still uses.
- **Ask first:** changing the scheme, the outcome bands, the careless/structural split, or the
  0.9 mastery value for a 4.
- **Always:** keep box positions on photos labelled as approximate (the quote and hint list is the
  reliable reference).

## Build order and estimate

| Step | Content | Estimate |
|---|---|---|
| 1 | Domain and rules: new error types, severity, 0–5 outcome bands, mastery value for a 4 | 20 min |
| 2 | Database: `mistakes` column on `mark`, score check 0–5, migration converting old marks | 20 min |
| 3 | Marker: new prompt (scheme, careless vs structural, hints only, locations), schema, fixtures | 40 min |
| 4 | Mark screen: scheme, typed-text boxes, photo boxes, PDF list, legend; 0–5 everywhere | 60 min |
| 5 | Retry copies the previous working safely | 30 min |
| 6 | Tests: unit, contract, end-to-end; real-API check on your sample answers and a photo | 40 min |

About 3.5 hours in total, done in that order. Steps 1–3 and 5 are low risk; step 4 on photos is
the least predictable (box accuracy).

## Open questions

None. All decisions above were confirmed by you on 14 November 2026.
