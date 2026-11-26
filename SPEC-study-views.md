# Spec Delta: Simpler course view, attempted-only scores, marks in place, PDFs in batch upload

Status: approved by the owner on 26 November 2026.
Original spec: [SPEC.md](SPEC.md) (course and sheet screens, marking screen, working upload);
[SPEC-batch-working.md](SPEC-batch-working.md) ("Uploading": "PDFs are not accepted here").

## Capability map

Six changes the owner asked for, grouped into modules that can each be built, tested and shipped
alone. No module depends on another, except that `mark-in-place` and `question-marks` should use
the same rule for "the mark of a question" (defined once, in `question-marks`).

| Module id | Request | Responsibility | Depends on |
|---|---|---|---|
| `course-default-tab` | 3 | Opening a course shows its Sheets tab | — |
| `topic-list` | 1 | The 3D skill map is replaced by a list of topics with word labels; the Progress chart shows bands | `course-default-tab` (the map's tab moves) |
| `attempted-score` | 2 | A sheet's score counts only the questions attempted | — |
| `question-marks` | 4 | The Questions tab shows which questions were attempted, with their mark | — |
| `mark-in-place` | 5 | An attempted question's page shows its mark directly, with a way to pick earlier attempts | `question-marks` (same mark rule) |
| `batch-pdf` | 6 | Batch upload of working accepts a PDF | — |
| `mark-on-official` | 7 | A toggle on every working upload: mark with AI now, or wait for the official solutions | `question-marks` (the new status) |

Build order: `course-default-tab` → `topic-list`; `question-marks` → `mark-in-place`,
`mark-on-official`; `attempted-score` and `batch-pdf` at any time. `batch-pdf` is the largest and
the only one that adds a package; `mark-on-official` is the only one that changes the database.

## Current behaviour

- A course opens on **Skill map**: a 3D chart of spheres (`src/components/charts/skill-map.tsx`,
  `skill-map-3d.ts`). Colour shows mastery, size shows attempts. Selecting a topic shows its
  mastery and the buttons *See mistakes*, *Revise this topic* and *Spot the error*. The tabs are
  Skill map, Sheets, Mistakes, Progress.
- The Sheets tab shows, for each sheet, *Submitted x / total* and *Average score*: the mean, over
  questions with a mark, of each question's best score out of 5 (`sheetStats` in
  `src/db/queries/history.ts`). The sheet **Summary** is written only "once every question has a
  marked attempt".
- The sheet's Questions tab lists each question with its time estimate, hint status and topics.
  Nothing shows whether it was attempted.
- On a question whose latest attempt is submitted, the page says "Your working has been
  submitted" with a **See the mark** button that opens `/questions/<id>/mark?attempt=<id>`. Older
  attempts can be reached only from the History tab.
- Working for one question can be photos or one PDF. The batch upload (*Upload working for
  several questions*) takes up to 10 photos only.

## New behaviour

### `course-default-tab`

- Opening a course (`/courses/<id>`) shows the Sheets tab. The tabs are, in order: **Sheets,
  Topics, Mistakes, Progress**.
- The old Sheets address `/courses/<id>/sheets` keeps working (links, bookmarks, the e2e tests),
  and the Sheets tab is shown as selected on both addresses.
- The Delete course button and the empty state ("Upload your first problem sheet…") stay on the
  page that opens first.

### `topic-list`

Aim: show how strong each topic is without false precision. Mastery is still computed exactly as
today (`src/lib/mastery/mastery.ts`) and still drives revision sessions and the order of the list;
only what is shown changes.

- The Topics tab (`/courses/<id>/topics`) replaces the skill map with a plain list, one line per
  topic: the topic's **name** and a **word label**. No percentage, bar, sphere or colour scale is
  shown on the line.
- **Labels**, decided by one pure function (`masteryBand`), from the topic's mastery and its number
  of marked long-form attempts (spot-the-error answers are not counted for this):

  | Label | Rule |
  |---|---|
  | Too early to tell | fewer than 3 marked attempts (including none) |
  | Needs work | mastery below 0.45 |
  | Getting there | mastery from 0.45 up to and including 0.70 |
  | Solid | mastery above 0.70 |

  The cut-offs are constants next to `masteryBand`. Each label has its own tint (danger, warning,
  success; "Too early to tell" is outlined and muted), and the word is always shown, so colour is
  never the only cue.
- **The percentage on demand:** hovering over a label, or giving it keyboard focus, shows a small
  tooltip "Mastery 32% · 6 attempts" ("No marked attempts yet" when there are none). Screen readers
  read the label and the same text. On a touch screen, where there is no hover, the same line is
  shown at the top of the row when the row is opened.
- **Order:** weakest first by the underlying mastery value: topics with marked attempts by mastery,
  lowest first (ties by name); then topics with no marked attempts, by name. "Too early to tell"
  topics with marks sit in the order of their mastery like the others.
- **Opening a row** (click, tap, or Enter on the focused row) shows, below it: the percentage line,
  the prerequisites when the topic has any ("Needs: Product rule"), and today's actions *Revise*,
  *Spot the error* and *See mistakes* (same destinations as today). One row is open at a time;
  opening another closes the first. The open row is not kept in the address.
- One quiet line under the list explains the labels: "Needs work: below 45% · Getting there:
  45–70% · Solid: above 70% · Too early to tell: fewer than 3 marked attempts".
- The *Focus next* panel (`src/components/insights/focus-next.tsx`) is removed: the top of the list
  shows the same thing.
- **Progress tab:** the mastery-over-time chart keeps its lines, but its vertical axis shows the
  three bands as shaded regions labelled *Needs work*, *Getting there* and *Solid* (same cut-offs)
  instead of a 0–100% scale, and the "▲ +12 pts" change readout is removed. Its tooltip may show
  the band of a point, not a percentage.
- No percentage of mastery is shown anywhere else in the app, except in the label tooltips and open
  rows above.
- The 3D skill map code, its dev page (`/dev/charts/skill-map`) and its tests are deleted, as are
  any packages only it uses.

### `attempted-score`

- **A question counts once, whatever its parts.** The app stores each part as its own row with
  labels such as "2(a)", "2(b)", "3(a)(i)" (`parseSheet`). For scores and counts, parts are grouped
  into one **numbered question** by the label's text before its first "(" (trimmed): "2(a)" and
  "2(b)" are question 2; "3(a)(i)" and "3(a)(ii)" are question 3; "1" is question 1. A label with
  no "(" is its own question. Grouping is one pure function (`questionNumber`).
- **Mark of a numbered question** (out of 5): the mean of the marks of its **marked** parts (each
  part's mark is the `question-marks` rule: latest marked attempt), rounded to one decimal. Parts
  not yet marked do not lower it. Example: 2(a) 5/5 and 2(b) 3/5 → question 2 is 4/5; with only
  2(a) marked, question 2 is 5/5.
- **Attempted** numbered question: at least one of its parts has a mark. A part that is still being
  marked is not counted until its mark arrives.
- **Sheet score** = sum of the attempted numbered questions' marks ÷ (5 × number of attempted
  numbered questions), shown as marks and a percentage. Numbered questions never attempted do not
  lower it.
- **Attempted count** = attempted numbered questions / all numbered questions on the sheet, shown
  everywhere the score is: **"Attempted 5 / 9"**.
- Where it is shown:
  - **Sheets tab row:** *Attempted 5 / 9* (replacing *Submitted x / total*) and *Score 17 / 25
    (68%)* (replacing *Average score*); "–" when nothing is marked.
  - **Sheet pages:** one line under the sheet title, **above the sheet's tabs**, so it is visible on
    every sheet tab: **"17 / 25"** large, then "68% · attempted 5 of 9 questions". With nothing
    marked: "Attempted 0 of 9 questions · no marks yet".
  - **Summary tab:** the same line at the top of the summary.
- The Summary is available once **at least one** question has a mark, and says which numbered
  questions it covers ("Based on questions 1, 2, 4 and 7"; a question with only some parts marked
  is named with those parts, "2(a)"). It is rewritten when a new mark arrives, as it is today when
  it is out of date. Its AI input (`summariseSheet`) is still one item per marked part.
- The Questions tab still has one row per part, each with its own mark (`question-marks`); only the
  score and the counts group parts.

### `question-marks`

- **The mark of a question** is the current mark (after any re-mark or official mark) of its
  **latest submitted attempt**. This rule is used by the Questions tab, `attempted-score` and
  `mark-in-place`.
- On the sheet's Questions tab, each question row shows one status on its right, at the top, so
  the column can be scanned:
  - not started: nothing (unattempted questions stand out by having no status);
  - draft (working written or attached, not submitted): a "Draft" pill;
  - submitted, being marked: a "Marking…" pill;
  - submitted with *Mark with AI now* off, no official solution yet: a "Waiting for official
    solution" pill (`mark-on-official`);
  - marked: five pips filled up to the score and coloured by outcome (full, partial, stuck, the
    colours of the mark screen), then "3 / 5"; under it the outcome in words (*Full marks*,
    *Correct, slips* for a full outcome below 5, *Partial*, *Stuck*), and "· 3 attempts" when
    there is more than one;
  - marking failed: a red "Marking failed" pill.
- The status is visible without opening the question and readable by a screen reader (text, not
  colour alone; the pips are decorative).
- The hint status moves out of every row: "Hints ready" is no longer shown. A row shows "Hints
  being prepared…" or "Hints failed" only when that is the case, next to the time estimate.
- The question text, topics and the *Upload working for several questions* / *Submit all drafts*
  bar are unchanged.

### `mark-in-place`

Layout: option C of the mockups (minimal, attempts as a timeline). When the latest attempt of a
question is submitted, the question page shows, under the question text and in this order, with no
**See the mark** step and no cards inside cards:

1. **Locked hints line:** one line, for example "2 hints used · 12:40" (time only when the sheet's
   timer is on), in place of the hint buttons and the timer.
2. **Attempt timeline**, only when the question has more than one submitted attempt: one dot per
   submitted attempt, oldest on the left, newest on the right, coloured by outcome, with its date
   under it. The selected attempt's dot is ringed; the newest is selected by default. Choosing a dot
   (click, tap, or arrow keys and Enter) shows that attempt below. The choice is kept in the
   address (`?attempt=<id>`), so it survives a refresh and can be linked. Each dot has an accessible
   name ("Attempt 2, 24 November, 2 out of 5, partial"). With more than 6 attempts, the oldest
   collapse into a "+N earlier" control that shows them.
3. **Score line:** "3 / 5 · Partial", then quietly the error type and the hints used for that
   attempt ("Algebra slip · no hints").
4. **Feedback:** the marker's 2–4 sentences, as plain text.
5. **Working, by type** (shown, not folded away; mistakes are numbered once across all of it):
   - *typed working:* the text with each mistake's step underlined and its short note next to it
     (from today's quote matching in `working-with-boxes`);
   - *photos:* each photo in order, with a numbered box around each located mistake (today's
     `photo-with-boxes`, using the `box` the marking AI returns) and a list of the matching
     numbered notes under the photos; hovering or focusing a box or a note highlights both, and on
     a phone tapping a note scrolls to its box;
   - *a PDF:* the file as today, and each note says its page ("Page 2"); no boxes on PDF pages;
   - a mistake with no position (no box, no matching quote) is listed without a number on the
     working;
   - typed text and photos together: typed text first, then photos, then one list.
6. **Official solution**, when it is unlocked: one collapsed line that opens it.
7. **Actions** as text links: *Start a new attempt*, *Ask for a re-mark* (with today's limit of two
   per attempt), and *Retry marking* when marking failed.

- **Official solutions win.** Once a question has an official solution (uploaded on the sheet's
  Solutions tab):
  - the solution shown in item 6, on the Solutions tab and anywhere else a solution is shown is the
    **official** one, labelled "Official solution"; the AI-written solution is not shown for that
    question;
  - every submitted attempt on it is re-marked against the official solution (today's
    `remark.ts`), and the mark shown on the score line, the timeline dots, the Questions tab and in
    `attempted-score` is that **official** mark once it exists; the AI mark stays in the history
    ("All marks for this attempt") only;
  - while that re-mark is running, the score line shows the AI mark with "Re-marking against the
    official solution…", and the page refreshes by itself;
  - a question the official document has no solution for keeps its AI-written solution and AI
    mark, labelled "AI-written solution" so the difference is visible.
- While the selected attempt is still being marked, items 3–5 are replaced by the waiting state the
  mark page shows today, and the page refreshes by itself.
- **Start a new attempt** clears the area below the timeline and shows the working form and hints;
  the timeline still lists the earlier attempts, so they can be looked at before submitting.
- The handwriting is not converted to text: the marking AI reads the photos directly, as today.
  Only each mistake's quote is text.
- `/questions/<id>/mark?attempt=<id>` keeps working (revision sessions and old links), and
  redirects to the question page with the same attempt selected.
- Revision sessions (`?session=`) keep their own attempts and their next-question link.

### `mark-on-official`

Request 7: "When uploading batch PDF or any answer to any question, provide a toggle whether I want
AI to automark. If the toggle is switched off, the question will only be marked when the official
solution is provided."

- **The toggle.** Every place that submits working has one switch, **Mark with AI now**, next to
  the submit button: the question page's working form, *Submit all drafts* on the sheet page, and
  the batch upload's *Submit and mark* (where it applies to every question in that batch).
  - It is a switch (`role="switch"`, operable with Space and Enter), labelled "Mark with AI now",
    placed right of the submit button, with one line of plain text under it that says what will
    happen.
  - On (default for a new sheet): today's behaviour, the AI marks against the AI-written solution.
    Text under it: "The AI marks it in about a minute."
  - Off: the submission is saved and **not marked** until official solutions are uploaded. Text:
    "Not marked until the official solutions are uploaded."
  - The switch starts in the position last used on that sheet (stored on the sheet), so turning it
    off once covers the rest of the sheet.
  - When the question already has an official solution, the switch is still shown but **greyed
    out and cannot be changed**, with a lock icon and the text "Marked against the official
    solution" beside it;
    the submission is marked against the official solution at once (see below). In the batch
    upload, the switch is greyed out when every matched question has an official solution; when
    only some do, it stays usable, says "Applies to N of M questions", and applies to the others.
    On the batch review screen each matched question shows how it will be marked: a fixed
    "Marked against the official solution" label, or "AI marks now" / "Waits for official
    solution", which follows the switch. The greyed-out switch is announced to screen readers with
    the same text.
- **Waiting status.** A submission made with the switch off has the new mark status
  `awaiting_official`. It shows as a **"Waiting for official solution"** pill on the Questions tab
  (`question-marks`), and on the question page in place of the score line and feedback
  (`mark-in-place`): the working is still shown, then the line "Marked when the official
  solutions are uploaded." and the *Mark with AI instead* link. It has no mark, so it does not count in the
  sheet score, the attempted count, the Summary, mastery or revision until it is marked. Its
  attempt is locked like any submitted attempt (hints locked, *Start a new attempt* available).
- **When official solutions are uploaded** (Solutions tab), the existing job (`remark.ts`) marks
  every waiting submission on a question that now has an official solution, against that solution,
  with basis `official`, along with the re-marks it does today. Each becomes "Marking…", then
  marked.
- **No official solution for that question** in the uploaded document: the submission keeps
  waiting, and its page offers a text link **Mark with AI instead**, which marks it against the
  AI-written solution as today. That link is also available on any waiting submission at any time.
- **A new submission on a question that already has an official solution** is marked against the
  official solution straight away, with basis `official`, whatever the switch says. (Today it is
  marked against the AI solution and only re-marked at the next upload; this changes that, so
  request 6, "official solution over AI", also holds for later submissions.)
- The solution unlock rules, hints and the AI-written solution are unchanged.

### `batch-pdf`

- *Upload working for several questions* accepts **one PDF of up to 10 pages, or up to 10 photos**,
  not both at once, by file picker or drag-and-drop.
- In the browser, each PDF page is rendered to a JPEG image at the same size limits as a resized
  photo. From then on each page is treated exactly like a photo: uploaded, sent to `matchWorking`,
  shown on the review screen, its regions adjustable, and cropped on submit. The rest of
  SPEC-batch-working.md is unchanged.
- A PDF of more than 10 pages, a password-protected PDF, or one that cannot be read, is refused in
  the browser with a message before anything is uploaded.
- Pages with no working on them come back from `matchWorking` with no regions, as an empty photo
  would today.

## Success criteria

- `course-default-tab`: `/courses/<id>` shows the sheet list and upload form; the Sheets tab is
  selected on both `/courses/<id>` and `/courses/<id>/sheets`; tabs read Sheets, Topics, Mistakes,
  Progress.
- `topic-list`: a unit test of `masteryBand` at and around each cut-off (0.4499, 0.45, 0.70,
  0.7001) and for 0, 2 and 3 attempts; the Topics tab lists topics weakest first with one label
  each and no percentage on the line; hovering or focusing a label shows "Mastery N% · K attempts";
  opening a row shows that line, the prerequisites and the three actions, and closes any other open
  row; the Progress chart shows the three bands and no % axis or "pts" readout; *Focus next* is
  gone; no WebGL or canvas is used on the Topics tab; the skill map files are gone and
  `npm run build` has no reference to them; mastery values and revision sessions are unchanged.
- `attempted-score`: unit tests of `questionNumber` ("1" → "1", "2(a)" → "2", "3(a)(ii)" → "3",
  " 10 (iii)" → "10", "A" → "A"); of the score on a sheet with questions 1, 2(a), 2(b), 3 and 4,
  where 1 is 5/5, 2(a) 5/5, 2(b) 3/5, 3 is still marking and 4 is not started: question 2 is 4/5,
  the score is 9 / 10 (90%) and the count "Attempted 2 / 4"; with only 2(a) marked, question 2 is
  5/5; the Sheets tab row shows *Attempted* and *Score*; the score line is shown above the tabs on
  every sheet tab and on the Summary; the Summary is generated with one marked part and names it.
- `question-marks`: a unit test of the status for each case (none, draft, marking, marked with one
  and with several attempts, a full outcome below 5, failed); the Questions tab shows them on the
  right of each row; the mark is the latest attempt's, not the best; "Hints ready" no longer
  appears, "Hints being prepared…" and "Hints failed" still do.
- `mark-in-place`: on an attempted question, the evaluation is on the question page with no extra
  click, in the order above; with one attempt there is no timeline; with three attempts the
  timeline shows three dots, the newest selected, and choosing the oldest shows its working and
  mark and puts its id in the address; a photo mistake with a box is drawn as a numbered box with
  the same number in the list; a PDF mistake shows its page; a mistake without a position is
  listed without a number; the dots can be chosen with the keyboard; the old `/mark` address
  redirects with its attempt kept; revision sessions still work; with an official solution and
  an official mark, the page shows the official solution and the official mark (never the AI
  solution), and while the official re-mark is running it says so; a question without an official
  solution shows "AI-written solution".
- `mark-on-official`: with the switch off, submitting from the question page, *Submit all drafts*
  and the batch upload makes no AI marking call (checked with the fake AI client) and shows
  "Waiting for official solution"; the text under the switch changes with its position; the
  switch works with the keyboard; it remembers its last position per sheet; in a batch with some
  official solutions it says "Applies to N of M questions" and each question shows its marking
  label; uploading
  official solutions marks the waiting submissions with basis `official`; a waiting question with no
  official solution keeps waiting and *Mark with AI instead* marks it; on a question that already
  has an official solution the switch is greyed out with "Marked against the official solution"
  and cannot be changed, and a submission is marked once, with basis `official`, and no AI-basis
  mark; waiting submissions do not count in the score, the attempted count, the Summary or
  mastery.
- `batch-pdf`: a 3-page PDF goes through batch upload as 3 pages and its questions are submitted
  and marked; an 11-page PDF and a PDF plus a photo are refused before upload.
- Not changed: marking, hints, mastery, the per-question working upload, revision sessions, the
  export of working, the other course tabs.
- `npm run lint`, `npm run typecheck`, `npm test` and `npm run e2e` pass; the e2e tests that open
  `/courses/<id>` or "See the mark" are updated to the new screens.

## Boundaries (deltas only)

- **Always:** show status as text as well as colour; keep every old address working (redirect when
  the page moved).
- **Ask first:** adding the PDF renderer package for `batch-pdf` (planned: `pdfjs-dist`, rendering
  in the browser only); the database change of `mark-on-official` (planned: a new
  `awaiting_official` value of the mark status, and a boolean on the sheet for the switch's last
  position, in one migration); no other module changes the schema.
- **Never:** send a PDF to `matchWorking` as a PDF (the review screen needs page images); drop an
  attempt or a mark when hiding the "See the mark" step.

## Out of scope (deferred)

- A different visual chart for topics (for example a flat 2D graph of prerequisites): the list
  comes first; a chart can be added later if the list is not enough.
- Anki-style stages and due dates on the Topics tab (New / Learning / Solid / Relearning, "Due
  today"): considered and set aside for word labels; the spaced-review due dates already exist and
  could be shown later.
- Showing the last few attempt outcomes (dots) next to each label.
- Choosing which questions count toward the score by hand (for example "only the ones set as
  homework").
- PDFs mixed with photos in one batch upload, and PDFs longer than 10 pages.
- Comparing two attempts side by side.
- A full photo → LaTeX transcript of handwritten working (so it could be shown typeset like typed
  working): would cost one more AI call, or more output tokens, per submission.
- Boxes around mistakes on PDF pages (today only the page number is known); possible once pages are
  rendered as images, as `batch-pdf` does.
- A note per mistake saying whether it cost a mark (the marking reply has no such field today).
- The Anki-style or "one line, details folded" (A) and "mistakes written into the working" (B)
  layouts for the mark: considered, C chosen.

## Open questions

None. Decided by the owner on 26 November 2026:

1. Skill map: replaced by the word-label list in `topic-list`; percentages only on hover or in an
   open row; bands on the Progress chart; *Focus next* removed.
2. Score: both the Sheets tab score and the Summary change, with an attempted count ("Attempted
   5 / 9") wherever the score is shown; a question with parts (i), (ii), (a), (b) counts as one
   question.
3. A question's mark is its **latest** marked attempt.
4. Batch PDF: up to 10 pages.
5. Re-mark: allowed on **any** submitted attempt (today's rule, two per attempt).
6. Once official solutions are uploaded, each marked question shows the **official** solution and
   the official mark, not the AI ones (`mark-in-place`, "Official solutions win").
7. A **Mark with AI now** switch on every working upload; off means wait for the official
   solutions (`mark-on-official`).

Decision made while writing the answers in (owner may change it): a question with several parts
scores the mean of its marked parts, so each numbered question weighs the same in the sheet score
however many parts it has.
