# Spec Delta: Demo account for hackathon judges

Status: implemented (released 15 November 2026).
Original spec: [SPEC.md](SPEC.md), sections "`accounts`" (Google sign-in, test sign-in off
in production) and "Boundaries" ("Never: enable the test sign-in in production"). Uses the
features of [SPEC-marking-v2.md](SPEC-marking-v2.md),
[SPEC-spot-the-error.md](SPEC-spot-the-error.md) and
[SPEC-spaced-review.md](SPEC-spaced-review.md).

## Objective

Hackathon judges open one link and are inside the app at once, with no sign-in, looking
at a student who has worked through real problem sheets for three weeks: marks with
mistakes, hints used, a skill map with weak and strong topics, common errors, review
dates and past revision sessions. They can also try everything themselves (submit
working, dispute, revise, spot the error) without spoiling the demo for the next judge.

## Current behaviour

- Signing in needs a Google account. The test sign-in (`name@test.local`) works only in
  development and end-to-end tests, never in production.
- There is no prepared data: a new account starts empty.

## New behaviour

### 1. Opening the demo

- **`/demo`** is an open link (no key). Opening it signs the visitor in to a **private
  copy** of the demo student and opens the courses list. There is no sign-in page.
- A visitor who already has a live demo copy in this browser goes back to the same copy.
  Their changes stay for the rest of their visit.
- A **"Try the demo"** button on the landing page and the sign-in page leads to `/demo`.
- Every page of a demo copy shows a thin banner: "Demo: your changes are private and are
  deleted after 24 hours." with a **Start again** button, which gives a fresh copy.
- A demo copy cannot be linked to a Google account, and signing out ends it.

### 2. Demo copies

- A copy holds everything the template student has: courses, topics, sheets and their
  files, questions, hints, solutions, attempts, working, marks, disputes, common errors,
  revision and spot-the-error sessions.
- **Times are shifted** so that the template's history ends at the moment the copy is
  made. The history always looks like the last three weeks, and review dates are always
  current.
- Files in R2 are not copied: a copy reads the template's files. A file a judge uploads
  belongs to their copy only.
- A copy is **erased 24 hours** after it was made, with any files uploaded to it. Erasing
  runs in the background when anyone opens `/demo`, and never touches the template or
  its files.
- **Limits:** at most 200 live copies. When a new one would be the 201st, the oldest copy
  is erased first, so link-preview bots cannot fill the database.

### 3. AI use in a copy

- A demo copy may make at most **30 AI calls** in total (marking, disputes, sheet parsing,
  hints for an uploaded sheet, variants, spot-the-error questions and judging).
- Once the limit is reached, an action that would call the AI is refused before it starts,
  with "The demo limit for AI is reached. Start again for a fresh copy, or sign in with
  Google to use the full app." Work already in progress may finish.
- Browsing, revealing stored hints and reading marks need no AI and are never limited.

### 4. The demo content (the template)

A one-off script builds the **template student** in the production database, using the
real pipeline and the real AI on the sheets in `Sample Problem Sheets/`:

- **Courses:** Numbers, Analysis I, Sequences and Series.
- **Sheets:** all three sheets of each course are uploaded and parsed, with hints and
  worked solutions. Sheets 1 and 2 also have their official solutions uploaded. Sheet 3
  of each course is left unattempted, for judges to try.
- **Attempts on sheets 1 and 2,** spread over three weeks and marked by the real AI:
  - **Mixed results:** about 40% full, 35% partly right and 25% stuck, with hints used
    on about a third. Some topics end strong and some weak, so the skill map, the
    progress chart and the review dates have shape.
  - **Recurring mistakes:** 3 or 4 misconceptions repeated across sheets and courses
    (for example sign errors when rearranging inequalities, applying a convergence test
    without checking its conditions, and dropping a case). The common-errors list then
    shows them seen several times, and spot the error has material.
  - The student's working is written in plain typed text with LaTeX, as a student would
    type it, and contains each mistake naturally. No real person's work is used.
- **Revision:** one finished long-form session and one finished spot-the-error session of
  5 questions with its summary.
- The script can be run again to rebuild the template. It replaces the old template
  without touching live copies until they expire.
- The template user can never be signed in to directly.

## Success criteria

1. Opening `/demo` in a fresh browser lands on the courses list within a few seconds,
   with no sign-in; a second visit from the same browser returns to the same copy.
2. Two browsers get two separate copies: a submission or "Not me" in one is not seen in
   the other, and the template is unchanged.
3. The copy shows: 3 courses, 9 sheets, marked attempts over the last three weeks with
   mixed outcomes, at least 3 common errors each seen 2 or more times, due and upcoming
   reviews in Focus next, and one finished session of each revision kind.
4. Times in a copy end at the moment it was made (the newest attempt is from today).
5. The 31st AI call of a copy is refused with the message above; browsing still works.
6. Copies older than 24 hours are erased with their own uploaded files, and the
   template's files are never deleted; there are never more than 200 live copies.
7. Start again gives a fresh copy; signing out ends the demo.
8. Google sign-in and every existing feature behave exactly as before for real users.
9. Works at 375 px wide without sideways scrolling (banner included).

## Boundaries (only the deltas)

- **Changes to SPEC.md's Never list:** a sign-in without Google is allowed in production,
  but only the demo sign-in, and it can only create or reopen a demo copy. The `test.local`
  test sign-in stays off in production.
- **Always:** keep demo copies apart from real users (no shared rows except read-only R2
  files); check the AI limit before starting AI work in a copy.
- **Ask first:** the migration for demo fields; running the template script against the
  production database (it calls the real AI, about a few dollars once); changing the
  limits (24 hours, 30 calls, 200 copies).
- **Never:** let a demo visitor reach the template, another copy or a real user's data;
  delete a template file when erasing a copy; put real student work in the template.

## Assumptions (correct me if any is wrong)

1. The demo session lasts as long as the copy (24 hours); after that `/demo` makes a new
   one.
2. The demo copy's courses list is the start page; there is no guided tour.
3. The template is built locally by me with your go-ahead, against Neon and R2, and its
   cost is a one-off.
4. The 30-call limit counts calls, not dollars; a sheet upload costs several calls
   (parsing, then hints for each question).

## Out of scope (deferred)

- A guided tour or tooltips for judges.
- Turning a demo copy into a real account.
- A key-protected link or per-judge analytics.
- Deleting courses and sheets ([SPEC-delete.md](SPEC-delete.md), still deferred).
