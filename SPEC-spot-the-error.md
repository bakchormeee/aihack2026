# Spec Delta: Spot the error (revision built from the student's own common errors)

Status: proposed, not approved.
Original spec: [SPEC.md](SPEC.md), sections "`revision`" and "`mastery`"; builds on
[SPEC-marking-v2.md](SPEC-marking-v2.md) (the stored list of mistakes on each mark).

## Objective

Students repeat the same misconceptions (for example, treating $(3-2)+8$ as $3-(2+8)$).
Finding an error in someone else's working trains the checking habit that catches it in
their own. This change adds:

1. **A memory of common errors.** For each course, the app keeps a list of the student's
   misconceptions, built from the mistakes in their marks and refreshed after each new
   mark.
2. **Spot-the-error questions.** The AI writes a new question on a topic where the
   misconception was seen, and a full worked solution with zero, one or two of the
   student's own misconceptions planted in it. The student ticks the wrong lines and
   explains what is wrong in each.
3. **A separate kind of revision session.** On the Revise page the student chooses either
   the existing long-form session or a spot-the-error session.

## Current behaviour (what changes)

- A revision session is long-form only: retry questions and AI variants, sized by time
  (20, 45 or 90 minutes), about 60% retry and 40% variant.
- Each mark from the new marker stores its mistakes (type, quote, hint, location). Older
  marks store only an error type and a first wrong step.
- Nothing groups mistakes across attempts. The Mistakes tab lists wrong attempts only.

## New behaviour

### 1. Common-errors memory (per course)

- A **misconception** is one specific recurring error, written as one sentence in plain
  words with maths in `$…$`. Example: "Removes a bracket after a minus sign without
  changing the signs inside it, e.g. writes $3-(2+8)$ as $3-2+8$." Each misconception has:
  - the error type (from the seven in Marking v2) it most often shows as;
  - the topics where it was seen;
  - the mistakes behind it (which mark, which mistake), with the student's quote;
  - **times seen**: the number of distinct attempts with at least one mistake behind it;
  - when it was last seen;
  - whether the student has hidden it.
- **Sources:** every mistake in a mark's list. A mark from before Marking v2 counts as one
  mistake (its error type and first wrong step) when it has a first wrong step. Only the
  current mark of each attempt counts. A full-mark attempt with careless slips (a 4) counts.
- **Building and refreshing:** after each new mark (first mark, dispute, official re-mark)
  that lists a mistake, a background job asks the AI to place the new mistakes into the
  existing list: add each one to a matching misconception or create a new one. Existing
  misconceptions keep their identity and wording unless the AI merges two. The first time a
  course's list is needed and does not exist, it is built from all existing marks.
- **"Not me":** the student can hide a misconception. A hidden one is never planted, is not
  shown in the list, and new mistakes matching it do not bring it back.
- The memory belongs to one student and one course. No other student's data is ever used.

### 2. Revise page

- The student picks a course, then a mode:
  - **Long-form** (unchanged).
  - **Spot the error**: optional topics, and a length of **5, 10 or 15 questions**.
- In spot-the-error mode the page shows the course's **common errors list**: each visible
  misconception with its sentence, times seen, last seen, one example quote from the
  student's own working (maths rendered), and a "Not me" button.
- With no visible misconception (or none in the chosen topics), the page explains that
  spot-the-error questions are built from mistakes in marked answers, and the start button
  is disabled.

### 3. Building a spot-the-error session

- **Choosing misconceptions:** misconceptions seen twice or more come first, most often
  seen first; if they cannot fill the session, misconceptions seen once are added, most
  recent first. Questions are dealt out in turn across the chosen misconceptions, so one
  misconception is not used for every question while others are waiting.
- **Errors per question:** zero, one or two planted errors. About 1 question in 5 has none,
  about 1 in 5 has two, and the rest have one. Every planted error is one of the student's
  visible misconceptions; a two-error question uses two different ones where possible.
- **The question** (`writeFlawedSolution`, new AI call): a new question on a topic where the
  misconception was seen (within the chosen topics), at the level of that course's sheet
  questions, with:
  - the question text;
  - a complete worked solution as **numbered lines**, one step per line, all maths in
    `$…$` (the Marking v2 LaTeX check applies, with one retry);
  - for each planted error: its line number, the misconception it comes from, what is wrong
    (one or two sentences), and the correct version of that line;
  - the question's topics.
  The AI must solve the question correctly first and then plant each error so that it
  looks natural and changes the working from that line on as the error would. Apart from
  the planted errors, every line must be correct. It must not mention the student or the
  misconception in the question or solution.
- The session builds in the background, as long-form sessions do (building → ready, or
  failed with a retry button). A question that fails to generate twice is left out; the
  session is still usable if at least one question was written.

### 4. Answering

- The student sees the question and the numbered solution. They either tick **every line
  they think is wrong** and write a short explanation for each ticked line (required,
  1–500 characters, maths allowed), or press **"No error"**.
- No hints. One answer per question; no retry of the same question and no dispute.
- **Judging** (`judgeSpotAnswer`, new AI call): for each ticked line that has a planted
  error, the AI decides whether the explanation correctly identifies what is wrong (a
  correct correction counts; it need not use the same words). Ticked lines without a
  planted error are wrong accusations. Line matching is exact and done in code, not by the
  AI.
- **Outcome:**
  - **Correct**: the ticked lines are exactly the planted lines (or "No error" on a question
    with none) and every explanation is judged right.
  - **Partly right**: at least one planted error ticked with a right explanation, but not
    correct (one missed, a wrong accusation, or a wrong explanation of the other).
  - **Stuck**: anything else, including "No error" on a question that has errors, and any
    ticked line on a question that has none.
- Time spent on each question is recorded as for other attempts.

### 5. After answering (full reveal)

- The student sees the outcome, then each planted error: its line highlighted, what is
  wrong, the correct line, and "Based on your common error: …" with the misconception's
  sentence. Wrongly ticked lines are marked "this line was correct". For each of their
  explanations, the AI's one-sentence judgement is shown.
- Giving the correction here is allowed: the flawed solution is AI-written, not the
  student's own working, so the Marking v2 hints-only rule does not apply.
- "Next" goes to the next question; the last question leads to a short session summary
  (how many correct, partly right, stuck, and which misconceptions were missed).

### 6. Mastery

- A spot-the-error answer counts as evidence for the question's topics, at **half the
  weight** of a long-form attempt with the same basis. Long-form AI marks are provisional
  (weight 0.5), so a spot-the-error answer has weight **0.25**.
- Evidence uses the outcome value (correct 1.0, partly right 0.5, stuck 0), with no hint
  multiplier and no time factor.
- Spot-the-error answers do not change the misconception list (times seen counts the
  student's own mistakes only).

## Success criteria

1. After a mark with mistakes, the course's common-errors list includes them within a minute,
   grouped with matching earlier mistakes; times seen counts distinct attempts.
2. Old marks with a first wrong step are included when a course's list is first built.
3. "Not me" hides a misconception at once; it never appears in a session or the list again,
   even when new matching mistakes arrive.
4. The Revise page offers Long-form and Spot the error; long-form sessions behave exactly as
   before.
5. A spot-the-error session has the chosen number of questions (fewer only when some fail
   to generate, and then the student is told). Misconceptions seen twice or more are used
   before those seen once.
6. Every planted error is one of the student's visible misconceptions; across a session
   roughly 1 in 5 questions has no error and roughly 1 in 5 has two.
7. Solution lines and all AI text render as LaTeX; a reply with maths outside `$…$` is
   asked for once more.
8. Outcomes follow section 4 exactly. Line matching is tested in code with: exact match,
   a missed error, a wrong accusation, "No error" on a clean question, "No error" on a
   flawed one, and a ticked line on a clean question.
9. The reveal shows every planted error with the correct line and its misconception.
10. Mastery changes after an answer at weight 0.25 on the question's topics, and the skill
    map reflects it.
11. A course with no misconceptions explains why no session can start.
12. Works at 375 px wide without sideways scrolling.
13. A manual check with the real API on your own course: the planted errors match your real
    misconceptions, look natural, and the rest of each solution is correct.

## Boundaries (only the deltas)

- **Always:** use only this student's own marks for their list; keep hidden misconceptions
  out of every prompt; check every AI reply against its schema and the LaTeX check.
- **Ask first:** the database migration for the new tables (applied to Neon only with your
  go-ahead, as in Marking v2); changing the 1-in-5 mix, the 0.25 weight or the
  twice-else-once rule once built.
- **Never:** change long-form sessions, the marker or existing marks; show a misconception
  from another course or another student; plant an error that is not one of the student's
  visible misconceptions.

## Assumptions (correct me if any is wrong)

1. Spot-the-error questions have no hints, no retry and no dispute.
2. The misconception list is refreshed per new mark, not on a schedule.
3. Spot-the-error questions are stored apart from sheet questions and never appear in a
   sheet, the history, the mistake log or the hand-in export.
4. Generating one question takes about 20–40 s, so a session is written in parallel
   batches, as variants are today.

## Out of Scope (Deferred)

- Spot-the-error questions mixed into long-form sessions (you chose a separate mode).
- Per-misconception progress such as "getting better" (you chose mastery only).
- A shared list across courses.
- Editing a misconception's wording or merging two by hand.

## Open questions

None. The assumptions above stand unless you change them.
