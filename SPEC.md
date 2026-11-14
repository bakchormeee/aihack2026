# Spec: Problem Sheet Companion (working title)

Status: draft for discussion. Items marked **[ASSUMPTION]** are my defaults and
should be confirmed; open questions are collected in section 10.

## 1. Objective

Weekly problem sheets are less effective than they could be because students:

- get completely stuck and give up (or look at the full solution, which teaches little),
- never systematically revisit their mistakes,
- revise for finals by redoing everything rather than what they are weak at.

The app turns each problem sheet into a tracked learning loop:
**attempt (with graded hints) -> mark -> record -> resurface at revision time.**

### Target user

A university/A-level student doing weekly problem sheets in a quantitative
subject (maths, physics, CS theory, engineering). **[ASSUMPTION]** Single
student, self-serve; no tutor or class view in v1.

### Success criteria

1. A student can upload a sheet PDF and see it split into individual questions,
   each tagged with topics, in under 60 seconds.
2. Every question has 3 hints of increasing explicitness; no hint reveals the
   final answer; each reveal is recorded.
3. A student can submit an attempt (photo, PDF, or typed) and receive a mark,
   an outcome (full / partial / stuck), and line-level feedback.
4. The app can produce a revision session made of past-wrong, hint-assisted,
   and freshly generated similar questions, ordered by weakness.
5. Any past sheet can be reopened with a summary: what went well, what was
   hard, the student's original working, and practice questions.

## 2. Core user flows

### 2.1 Doing a sheet

1. **Upload** blank sheet (PDF or images). Student picks or creates a course.
2. **Parse**: app extracts questions (and sub-parts), renders maths as LaTeX,
   and tags each with 1-3 topics from the course's topic tree. Student can
   fix a wrong split or tag before starting (parsing will not be perfect).
3. **Attempt**: one question per screen. A timer starts on first view
   (pausable; auto-pauses on tab blur).
4. **Hints** (on demand, unlocked in order):
   - Level 1 - *Nudge*: which concept or theorem is relevant.
   - Level 2 - *Approach*: the strategy and the first step.
   - Level 3 - *Skeleton*: the full outline with the computations left out.
   Hints are generated at parse time so reveal is instant.
5. **Submit**: per question or whole sheet. Upload handwritten working
   (photo/PDF) or type it. Student also gives a 1-5 difficulty rating
   (one tap; skippable).
6. **Mark**: app returns outcome (full / partial / stuck), a score, and
   feedback anchored to the step where the working first goes wrong, plus an
   error type (conceptual / method / algebra slip / misread question /
   incomplete).
   If the student uploads the official mark scheme, marking uses it; otherwise
   the app marks against its own worked solution and labels the result as
   AI-marked. Student can dispute a mark ("I think this is right"), which
   triggers a re-mark and is logged.
7. **Sheet summary**: shown when all questions are submitted.

### 2.2 Reviewing history

- Sheet list per course, each with score, hints used, time spent.
- Sheet detail: every question with the student's submission, feedback, hints
  revealed, and a "try again" button (fresh attempt, old one preserved).
- Mistake log: all non-full outcomes across sheets, filterable by topic and
  error type.

### 2.3 Revising

1. Student starts a revision session, choosing course, length (e.g. 20 / 45 /
   90 min) and optionally topics. Setting an exam date enables a schedule.
2. App builds a queue from three sources:
   - **Retry**: original questions answered wrongly or with level 2-3 hints.
   - **Variant**: AI-generated questions on the same topic and technique with
     changed numbers/setup, so the student cannot answer from memory.
   - **Probe**: a few questions on topics with little or stale evidence, to
     keep the weakness model current.
3. Same attempt -> hint -> mark loop; results feed back into mastery.

## 3. Weakness model

Per (student, topic) keep a mastery score in [0, 1] with a confidence value.

Each marked attempt updates the topic(s) of its question with an evidence
score:

| Signal | Effect |
|---|---|
| Outcome | full = 1.0, partial = 0.5, stuck = 0 |
| Hints used | multiply by 1.0 / 0.85 / 0.6 / 0.35 for 0 / 1 / 2 / 3 hints |
| Time | mild penalty if far over the question's expected time |
| Recency | exponential moving average, newer attempts weigh more |
| Decay | confidence drops with time since last attempt |

Revision priority = (1 - mastery) weighted up by low confidence and by exam
proximity. Scheduling of retries follows a simple spaced-repetition interval
(1, 3, 7, 14 days; reset on failure). **[ASSUMPTION]** A simple transparent
formula is preferred over a learned model so the student can see why a
question was picked ("you used 3 hints on this in week 4").

## 4. Visualisations

Ranked by value for effort. The first four are proposed for v1.

1. **Topic constellation / skill map** - topics as nodes, prerequisite links
   as edges, node colour = mastery, node size = number of attempts, faded =
   stale. Clicking a node opens its mistakes and starts targeted practice.
   This is the home screen.
2. **Sheet heat strip** - one row per sheet, one cell per question, coloured by
   outcome, with 0-3 dots for hints used. A whole term fits on one screen and
   weak weeks are obvious at a glance.
3. **Hint ladder** - per question, a three-rung ladder that fills in as hints
   are revealed; on the sheet summary, a stacked bar of "solved at rung 0/1/2/3".
   Makes the goal ("climb fewer rungs") tangible.
4. **Mastery over time** - line per topic across weeks, with sheets and
   revision sessions marked. Shows that revision actually moves the line.
5. **Mistake fingerprint** - radar or donut of error types. "60% of your lost
   marks are algebra slips, not concepts" changes how a student revises.
6. **Time vs outcome scatter** - each question a dot (time on x, score on y,
   colour = topic). The quadrants are meaningful: fast+right (secure),
   slow+right (needs fluency), fast+wrong (careless), slow+wrong (gap).
7. **Exam readiness dial** - syllabus coverage weighted by mastery, with the
   three topics that would raise it most listed beneath.
8. **Forgetting forecast** - calendar strip showing which topics fall due for
   review on which day before the exam.
9. **Annotated working** - the student's uploaded handwriting with the first
   wrong line highlighted and feedback pinned beside it.
10. **Calibration chart** - self-rated difficulty/confidence against actual
    outcome; exposes over- and under-confidence.

Light motivation, kept honest: a streak for weekly sheets completed, and a
"redeemed" marker when a previously failed question is later solved with no
hints. No points or leaderboards in v1.

## 5. Suggested additional features

Effectiveness:

- **"I'm stuck" before hints**: ask the student to type one line on what they
  tried. This makes hints more targeted and the act of articulating often
  unsticks them. Skippable.
- **Check my approach**: student describes the plan, app says whether it is
  viable without solving it. Sits between hint 1 and hint 2.
- **Explain-back after a level 3 hint**: a one-question follow-up so a
  heavily hinted solve still produces learning.
- **Error-type-specific advice**: algebra slips get a checking routine;
  conceptual errors get a linked prerequisite topic.
- **Mock exam builder**: timed paper weighted towards weak topics.
- **Worked solution locked until attempt or all hints used**, so it cannot be
  a shortcut.

Seamlessness:

- **Phone capture**: QR code on the desktop question page opens a phone camera
  upload for that exact question.
- **Whole-sheet upload with auto-matching**: one PDF of working, app assigns
  pages to questions; student confirms.
- **Paste or drag-drop anywhere**; LaTeX rendering throughout.
- **Editable parse**: fix question splits and topic tags inline.
- **Syllabus import**: upload the course outline to seed the topic tree and
  prerequisite links.
- **Export** mistake log as PDF or Anki deck.

## 6. Scope

### v1 (hackathon MVP)

- Upload and parse sheet; topic tagging; editable parse.
- Three-level hints with tracking.
- Submit working (image/PDF/typed), AI marking with outcome, error type, feedback.
- Timer and difficulty rating.
- History: sheet list, sheet detail with past submissions, sheet summary.
- Weakness model and revision session (retry + variant questions).
- Visualisations 1-4.

### Later

- Probe questions, exam-date scheduling, forgetting forecast, mock exams.
- Visualisations 5-10, phone QR capture, Anki export, syllabus import.
- Multi-user accounts, tutor/class view.

### Out of scope

- Being an authoritative grader: marks are formative feedback, always labelled AI-marked.
- Proctoring or cheating detection.
- Live tutoring chat (hints are structured, not open-ended chat) **[ASSUMPTION]**.

## 7. Technical approach **[ASSUMPTION - empty repo, nothing decided]**

| Layer | Choice | Reason |
|---|---|---|
| App | Next.js (App Router) + TypeScript | one deployable for UI and API |
| UI | Tailwind + shadcn/ui, KaTeX for maths | fast to build, good maths rendering |
| Charts | D3 for the skill map, Recharts for the rest | custom graph plus standard charts |
| Data | SQLite via Drizzle ORM | zero setup; swappable for Postgres |
| Files | local disk in dev, object storage later | uploads of sheets and working |
| AI | Claude API with PDF and image input, structured JSON output | reads handwriting and typeset maths directly |
| Auth | none in v1 (single local user) | fastest route to a demo |

AI calls (each returns schema-validated JSON):

1. `parseSheet(pdf)` -> questions with parts, LaTeX text, topics, expected time.
2. `generateHints(question)` -> three hints plus a private worked solution.
3. `markAttempt(question, solution, submission, markScheme?)` -> outcome, score,
   error type, first wrong step, feedback.
4. `generateVariant(question, weaknessContext)` -> new question with solution.
5. `summariseSheet(attempts)` -> went well, struggled, next steps.

Hints are checked against the worked solution so that levels 1-2 never contain
the final answer.

### Data model (core tables)

- `course` (id, name, exam_date)
- `topic` (id, course_id, name, parent_id) and `topic_prereq` (topic_id, prereq_id)
- `sheet` (id, course_id, title, file_path, uploaded_at)
- `question` (id, sheet_id, label, body_latex, expected_minutes, source: original | variant, parent_question_id)
- `question_topic` (question_id, topic_id)
- `hint` (id, question_id, level, body)
- `attempt` (id, question_id, started_at, seconds_spent, difficulty_rating, context: sheet | revision)
- `hint_reveal` (attempt_id, hint_id, revealed_at)
- `submission` (id, attempt_id, file_path | text)
- `mark` (id, attempt_id, outcome, score, error_type, feedback_json, disputed)
- `topic_mastery` (topic_id, mastery, confidence, updated_at)

Attempts are append-only; a retry is a new attempt, so history is never lost.

### Project structure

```
src/app/            routes: /, /courses/[id], /sheets/[id], /questions/[id], /revise, /history
src/components/     ui and chart components
src/lib/ai/         prompts, schemas, Claude client
src/lib/mastery/    weakness model and revision queue (pure functions)
src/db/             schema and migrations
tests/              unit and e2e
```

### Commands

```
npm run dev         start dev server
npm run build       production build
npm test            unit tests (Vitest)
npm run e2e         Playwright flow tests
npm run lint        ESLint + tsc --noEmit
npm run db:migrate  apply migrations
```

## 8. Testing

- Unit: mastery update and revision queue ordering (pure functions, full coverage).
- AI contract: each AI call validated against its schema using recorded fixtures;
  a small set of real sheets with known answers for marking sanity checks.
- E2E: upload -> hint -> submit -> mark -> appears in history -> appears in revision.
- Manual: handwriting photos of varying quality.

## 9. Boundaries

- Always: record every hint reveal and attempt; label AI marks as AI-marked;
  validate AI output against schemas; keep the API key server-side.
- Ask first: schema changes after data exists; adding dependencies; changing
  the mastery formula.
- Never: reveal the final answer in hints 1-2; overwrite or delete past
  attempts; commit secrets or uploaded student work.

## 10. Open questions

1. Which subjects first? Maths-heavy sheets need the strongest LaTeX and
   handwriting handling; essay-style subjects would change marking entirely.
2. Will students usually have official solutions to upload, or is AI-only
   marking the normal case?
3. Web app only, or is phone-first capture essential for the demo?
4. Single user for the hackathon, or are accounts needed?
5. Is the stack in section 7 acceptable, or is there a team preference?
6. Should hints stay strictly structured (3 levels), or is a follow-up
   "ask about this hint" chat wanted?
7. Timer: automatic, manual, or self-reported time only?
