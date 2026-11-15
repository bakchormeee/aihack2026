# Spec Delta: Deleting courses and sheets

Status: approved 15 November 2026; ready to plan (it was deferred while spaced review and the demo were built).
Original spec: [SPEC.md](SPEC.md), section "Data model" ("There is no delete for courses or
sheets in V1") and "Boundaries" ("Never: update or delete an attempt, submission, hint
reveal or mark"); out-of-scope row "Deleting courses or sheets".

## Capability map

| Module id | Responsibility | Depends on |
|---|---|---|
| `delete` (this spec) | Bin, restore and erase courses and sheets | — |
| `spaced-review` ([SPEC-spaced-review.md](SPEC-spaced-review.md)) | Topic review schedule in Focus next and revision | built first; when `delete` is built, binned work must not count as a review |

Build order: `spaced-review` first (built), then `delete`.

## Objective

A student can remove a course or a sheet they no longer want, for example a test upload,
a duplicate, or a finished module. Deleting is safe: it goes to a bin for 30 days and can
be restored, and only then is it erased for good.

## Current behaviour

- Courses and sheets cannot be deleted. Attempts, submissions, hint reveals and marks are
  append-only, and `attempt.question_id` has no cascade, so history is always kept.

## New behaviour

### 1. Deleting

- **Course page:** a "Delete course" action. **Sheet page:** a "Delete sheet" action.
- Both open a dialog that says what goes with it, then Cancel or Delete:
  - course: "This deletes *Name* with its 3 sheets, 24 questions and 41 attempts. You can
    restore it from Recently deleted for 30 days.";
  - sheet: the same with its questions and attempts.
  Counts include revision variants and their attempts (see section 2). A zero count is
  left out of the sentence.
- After deleting a course the student lands on the courses list; after deleting a sheet,
  on the course page. Both show "Moved to Recently deleted."
- Deleting is allowed while marking or a revision session is still being built. The job
  finishes, and what it saves is binned with the rest.

### 2. What a binned item takes with it

A binned **sheet** takes its questions, every revision variant descended from them (its
parent, or its parent's parent, and so on, is one of them), and all attempts, submissions,
hint reveals and marks on those questions.

A binned **course** takes everything in it: its sheets (as above), topics, revision and
spot-the-error sessions, and its common-errors list.

While binned, none of it appears anywhere:
- not in the courses list, the course page, the sheet list, history, the mistake log, the
  hand-in export or the skill map;
- not in mastery: its attempts are no longer evidence, so the skill map and the progress
  chart are recomputed without them;
- not in the common-errors list: a mistake from a binned attempt does not count towards
  times seen, so a misconception seen only there disappears from the list until it is
  restored;
- not in new revision sessions. In an existing session, items on binned questions are
  left out; a session with no item left says "The questions in this session were
  deleted." Spot-the-error questions do not belong to a sheet and stay;
- any URL to it shows the 404 page.

### 3. Recently deleted

- A "Recently deleted" page, linked from the courses list (the link is shown only when
  something is in the bin).
- It lists binned courses, and binned sheets whose course is not binned. Each row shows
  the name, the course (for a sheet), when it was deleted, "Erased on 14 December 2026"
  and a Restore button.
- **Restore** brings the item back exactly as it was, with all its history and mastery.
  Restoring a course does not restore a sheet that was deleted on its own before the
  course; that sheet stays in the bin with its own date.
- A sheet in a binned course is not listed on its own; it comes back with the course.

### 4. Erasing for good

- 30 days after deletion the item and everything it took (section 2) is erased from the
  database, together with its uploaded files in R2 (sheet PDFs and pages, submission
  photos). A stored file still used by a row that is not being erased is kept (files are
  shared when a retry copies a submission's photos).
- Erasing runs in the background when the student opens the courses list or Recently
  deleted, for their own items that are due. It is safe to run twice. If deleting a file
  in R2 fails, the database rows are still erased and the failure is logged.
- Erasing cannot be undone and is the only way rows in the append-only tables are deleted.

## Success criteria

1. A course or sheet can be deleted from its page after a dialog that shows correct counts.
2. A binned course or sheet, and everything listed in section 2, disappears from every
   list, page and export, and its URLs show the 404 page.
3. Mastery, the skill map, the progress chart and times seen are recomputed without binned
   attempts, and return to their old values after Restore.
4. Restore brings back the item with all its history; restoring a course leaves an
   earlier separately deleted sheet in the bin.
5. After 30 days the item, its history and its files are erased; a file still used
   elsewhere is kept; running the erase twice is harmless.
6. Another student's course or sheet can be neither deleted nor restored (404).
7. Works at 375 px wide without sideways scrolling.

## Boundaries (only the deltas)

- **Changes to SPEC.md's Never list:** rows of attempts, submissions, hint reveals and
  marks may be deleted, but only by the 30-day erase of a binned course or sheet. Nothing
  else deletes or updates them.
- **Always:** check ownership on delete, restore and erase; erase a user's own items only.
- **Ask first:** the migration that adds `deleted_at` to `course` and `sheet` (applied to
  Neon only with your go-ahead); changing the 30-day period.
- **Never:** erase anything before its 30 days are up; delete a stored file another row
  still uses.
- **Demo copies (added 15 November 2026, after [SPEC-demo.md](SPEC-demo.md)):** a judge
  can bin, restore and erase in their own copy like any student. Erasing in a copy never
  deletes a file of the demo student: only files under the copy's own folder are
  deleted, as when a copy is erased.

## Assumptions (correct me if any is wrong)

1. Binning is recorded as `deleted_at` on `course` and `sheet`; nothing else is changed
   when binning, so Restore only clears that date.
2. Erasing happens when the student next visits after the 30 days, not on a timer (no
   Vercel cron is added). An item may stay a little longer than 30 days if they do not
   visit.
3. There is no "Erase now" button and no undo toast.
4. Single questions still cannot be deleted once attempted (unchanged).

## Out of scope (deferred)

- Deleting a single topic, attempt or revision session.
- Deleting the whole account.
- An "Erase now" button on Recently deleted.
