# Spec Delta: Spaced review of topics (Anki-style)

Status: implemented (released 15 November 2026).
Original spec: [SPEC.md](SPEC.md), section "`revision`" (the 1, 3, 7, 14-day spaced
interval), and the "Focus next" panel on the course page
(`src/components/insights/focus-next.tsx`, `src/lib/insights/insights.ts`). Builds on
[SPEC-spot-the-error.md](SPEC-spot-the-error.md) (spot answers as evidence).
[SPEC-delete.md](SPEC-delete.md) is deferred, so there is no deleted work yet; when it is
built, binned work must not count as a review.

## Objective

Like Anki, each topic the student has practised gets a review schedule: an interval that
grows when they do well and resets when they struggle. Focus next shows when each topic's
review is due and puts due topics first, and revision sessions pick questions from the
topics that are due.

## Current behaviour

- Focus next ranks topics by revision priority (weak, uncertain, long unpractised), drops
  secure ones, then adds untried ones, and shows three. It shows no dates.
- Revision ranks retry questions due under a per-question ladder first: 1, 3, 7, then
  14 days after the last attempt, back to 1 day after a non-full outcome.

## New behaviour

### 1. What is scheduled

- Each topic of a course that has at least one review (below) has a schedule. An untried
  topic has none.
- The schedule is computed on read by replaying the topic's reviews in order, as mastery
  is. Nothing new is stored, so a dispute, an official re-mark or a deleted sheet changes
  the schedule at once.

### 2. Reviews and grades

- A **review** of a topic is a marked long-form attempt (sheet, retry or variant) on a
  question with that topic, using its current mark, or a judged spot-the-error answer with
  that topic.
- Each review gets a grade, from the outcome (no student input):

  | Grade | Long-form attempt | Spot-the-error answer |
  |---|---|---|
  | Again | stuck | stuck |
  | Hard | partial, or full with hint 2 or 3 | partly right |
  | Good | full with hint 1, or full with no hints but slow | correct |
  | Easy | full with no hints and not slow | — |

  "Slow" is the existing slow-attempt rule used by mastery.
- **One review per topic per day.** Several reviews of a topic on the same day (UK time)
  count as one, with the worst grade of that day, at the time of the last one.

### 3. Scheduling rule (SM-2, as in Anki)

Each topic has an interval (days) and an ease (starts at 2.5, never below 1.3).

| Grade | First review | Later reviews | Ease |
|---|---|---|---|
| Again | 1 day | 1 day | −0.20 |
| Hard | 1 day | interval × 1.2 | −0.15 |
| Good | 3 days | interval × ease | unchanged |
| Easy | 4 days | interval × ease × 1.3 | +0.15 |

- A later interval is rounded to whole days, is at least one day longer than the previous
  one (except after Again), and is at most 365 days.
- The interval grows from the previous interval, not from the time that actually passed,
  so reviewing late gives no bonus.
- **Due date** = the day of the last review + the interval. A topic is **due** on or after
  that day, and **overdue by N days** after it.

### 4. Focus next

- Order: topics due today or overdue first (most overdue first, then weakest), then the
  present ranking for the rest (weak, uncertain, then untried). A topic that is secure but
  due is shown; one that is secure and not due is left out, as today. Still three rows.
- Each row says one of: "Due today", "Overdue by 3 days", "Next review in 5 days
  (18 Nov)", or for an untried topic "Not tried yet". The existing reason sentence stays.
- A short line under the title says how many topics are due, e.g. "2 topics due for
  review", or "Nothing due. Next review on 18 Nov."

### 5. Revision sessions

- A retry candidate is **due** when at least one of its topics is due. This replaces the
  per-question 1, 3, 7, 14-day ladder; the candidate filter (not full, or full with hint 2
  or 3), ranking by priority after due, and the 60/40 split are unchanged.
- A retry's reason says "due for review of *Topic*" when it was picked because its topic
  is due.

## Success criteria

1. Grades follow the table in section 2 exactly, including spot-the-error answers and the
   one-review-per-day rule (worst grade wins), with unit tests for each case.
2. The schedule follows section 3 exactly: a test replays a known sequence of grades and
   checks every interval, ease and due date, including the minimum ease, the 365-day cap
   and "at least one day longer".
3. A dispute or re-mark that changes an outcome changes the schedule on the next page
   load.
4. Focus next puts due and overdue topics first and shows the due text of section 4;
   untried topics show "Not tried yet".
5. Revision picks questions whose topics are due first; long-form sessions are otherwise
   unchanged, and the old ladder is gone.
6. The rules live in pure functions with 100% line coverage, as for mastery.
7. Works at 375 px wide without sideways scrolling.

## Boundaries (only the deltas)

- **Ask first:** changing the grade table, the SM-2 constants (2.5, 1.3, −0.20, −0.15,
  +0.15, 1.2, 1.3, first intervals 1/1/3/4, cap 365) or the day boundary once built.
- **Never:** store a schedule that can disagree with the marks; let a spot-the-error
  answer change the common-errors list (unchanged rule).

## Assumptions (correct me if any is wrong)

1. Days are counted in UK time (Europe/London), the same for every student.
2. No database migration is needed: the schedule is computed from existing rows.
3. Mastery and its priority are unchanged; the schedule only adds due dates and ordering.
4. The skill map and the course's topic list do not show due dates (only Focus next does).

## Out of scope (deferred)

- The student rating their own reviews (Again / Hard / Good / Easy buttons).
- Scheduling single questions as cards, or FSRS.
- Reminders or emails when reviews are due, and an exam-date mode.
- A review calendar or forecast of upcoming reviews.
