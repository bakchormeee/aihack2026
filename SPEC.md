# Spec: Problem Sheet Companion — V1

Status: approved on 14 November 2026, including the assumptions marked **[A]**
and the cut order. Amended the same day after the plan audit (see
`tasks/plan.md`, "Spec amendments"). No code exists yet.

## Objective

Weekly maths problem sheets are less effective than they could be because
students:

- get completely stuck and give up, or read the full solution, which teaches little;
- never systematically revisit their mistakes;
- revise for finals by redoing everything rather than what they are weak at.

The app turns each sheet into a tracked learning loop:
**attempt (with graded hints) → mark → record → resurface at revision time.**

### User

A student doing weekly maths problem sheets, with their own account. The app
is for the student's own learning: sheets are not treated as assessed work, so
hints and marking are available at any time. There is no tutor or class view.

### Platform

A responsive web app, used in a browser on a laptop, tablet or phone. There
is no native mobile app. Every screen must be usable at a width of 375 px, so
that a student can photograph their working with a phone and upload it from
the phone's browser.

### User stories

1. As a student, I upload a blank sheet and get it split into questions tagged
   by topic, so I can work through it one question at a time.
2. As a stuck student, I reveal up to three hints of increasing explicitness,
   so I can make progress without seeing the solution.
3. As a student, I submit my working (photo, PDF or typed) and get a mark and
   feedback at the first wrong step, so I know where I went wrong.
4. As a student, I upload the official solutions a week later and get my
   marks confirmed and my mistakes reviewed.
5. As a student, I reopen any past sheet and see my working, feedback and a
   summary of what went well and what was hard.
6. As a student preparing for an exam, I start a revision session that gives
   me the questions I got wrong, the ones I needed hints for, and new similar
   questions, weakest topics first.
7. As a student who must hand a sheet in, I export my working as one PDF.

### Terms

- **Course**: one university module, for example "Analysis 1" or "Calculus
  and Applications". Every sheet belongs to exactly one course, chosen by the
  student at upload. Topics, the skill map, mastery, the mistake log and
  revision sessions are all separate per course.
- **Build module**: a part of the software, listed in the build map below.
  It has nothing to do with university modules.

## Build Map

This is how the software is divided for building. It is the same whichever
courses a student takes. (The per-course picture of a student's ability is
the skill map, in `viz`.)

V1 bundles several independently testable capabilities. They are specified
together in this one file **[A]**, but built and verified build module by
build module in the order below. Module ids are stable.

| Module id | Responsibility | Depends on |
|---|---|---|
| `accounts` | Sign-in, sessions, per-user data and file isolation | — |
| `sheets` | Courses, sheet upload, parsing into questions and topics, editable parse | accounts |
| `attempts` | Question screen, hints, timer, difficulty rating, submission of working | sheets |
| `marking` | Provisional marking, solution lock, dispute, official-solution re-mark, solutions review | attempts |
| `mastery` | Weakness model: mastery, confidence, revision priority (pure functions) | marking |
| `history` | Sheet list, sheet detail, sheet summary, mistake log, hand-in export | marking |
| `revision` | Revision queue, variant generation, revision session | mastery |
| `viz` | Skill map, sheet heat strip, hint ladder, mastery over time | mastery, history |

Build order: `accounts` → `sheets` → `attempts` → `marking` → `mastery`,
`history` → `revision` → `viz`

The core loop (`accounts` through `marking`) must work end to end before any
later module is started.

### Demo deadline and cut order

The demo is 12 hours after this spec was written (14 November 2026). Target
time per build module, in hours: `accounts` 0.75, `sheets` 2, `attempts` 1.5,
`marking` 2, `mastery` 0.75, `history` 1.25, `revision` 1.25, `viz` 1.5,
deployment and rehearsal 1.

If a module overruns, cut from this list, top first, rather than delay the
next module. Anything cut moves to "Out of Scope (Deferred)".

1. Email magic-link sign-in (keep Google only).
2. Merge and split in the editable parse (keep editing text, label and topics).
3. Playwright tests beyond one happy-path test of the core loop.
4. Mastery-over-time chart.
5. Disputing a mark.
6. Sheet heat strip.
7. Hand-in export.

Never cut: the core loop, official-solution re-marking, the revision session
with variants, and the skill map.

## Requirements by module

### `accounts`

- Sign-in by Google or by email magic link (Auth.js). No passwords.
- Every table row is owned, directly or through its parent, by one user.
  Every server-side read and write filters by the signed-in user's id.
- Uploaded files are private. They are served only through short-lived signed
  URLs issued after an ownership check.
- A signed-out visitor sees only the landing and sign-in pages.

### `sheets`

- A student creates **courses** (name only; one per university module).
- To upload a **sheet** the student must select one of their courses or create
  a new one. A sheet cannot exist without a course, and its course can be
  changed later only while the sheet has no attempts.
- Upload accepts one PDF (max 20 MB, max 30 pages) or up to 10 images
  (JPEG, PNG or WebP, max 10 MB each), by file picker or drag-and-drop. **[A]**
- Every image (sheet, solutions or working) is resized in the browser before
  upload to at most 2000 px on its long edge and saved as JPEG, so that phone
  photos stay within the AI input limits. Files are uploaded from the browser
  directly to object storage with a short-lived signed URL; the server then
  checks the stored file's owner, type and size before using it.
- **Parse** (`parseSheet`) runs in the background. The sheet has a status:
  `parsing`, `ready` or `failed`. A failed parse shows an error and a retry button.
- Parse output, per question: label (e.g. "3"), body in Markdown with LaTeX,
  1–3 topics, expected minutes. Sub-parts (a), (b), … stay inside the body of
  their question; the question is the unit that is attempted and marked. **[A]**
- **Topics**: the parser receives the course's existing topic list and returns,
  for each question, existing topics or new ones. For each new topic it may
  propose a parent topic and prerequisite topics. New topics are added to the
  course's topic tree. **[A]**
- **Editable parse**: before or after starting, the student can edit a
  question's body, label and topics, merge two adjacent questions, split one
  question at a chosen point, or delete a question. Editing the body of a
  question regenerates its hints and worked solution. Once a question has an
  attempt, only its label and topics can be edited: its body cannot be
  changed and it cannot be merged, split or deleted, because recorded hint
  reveals and marks refer to the original text and hints.
- **Hints and worked solution** (`generateHints`) are generated for every
  question as soon as parsing finishes, so that a reveal is instant. If a hint
  is requested before it is ready, the button shows a loading state.

### `attempts`

- One question per screen, with previous/next navigation and a sheet overview.
  Questions can be attempted and submitted in any order.
- An **attempt** is created when the student first opens a question or starts
  a retry. A question can have many attempts; none is ever overwritten.
- **Timer**: starts when the question is opened, can be paused, and pauses
  automatically when the tab loses focus. It can be switched off per sheet.
  An attempt with no time is valid.
- **Hints**: three levels, revealed on demand and only in order.
  - Level 1, *Nudge*: which concept or theorem is relevant.
  - Level 2, *Approach*: the strategy and the first step.
  - Level 3, *Skeleton*: the full outline with the computations left out.

  Every reveal is recorded with a timestamp against the attempt.
- **Hint level of an attempt** = the highest hint level visible during it.
  A retry started from the mark screen keeps the hints already revealed. An
  attempt started from history or from a revision session starts with all
  hints hidden. **[A]**
- **Submit working** for a question in any of three forms, treated equally:
  - images (JPEG, PNG, WebP; up to 10 per submission),
  - one PDF,
  - typed text in Markdown with LaTeX (`$…$`), with a live rendered preview.
- Working attached to an attempt is saved as a **draft** until it is
  submitted. An attempt has at most one submission, and a submitted
  submission cannot be changed.
- On submit the student may give a difficulty rating of 1–5 (one tap, skippable).
- "Submit all" on the sheet overview submits every question that has working
  attached but not yet submitted. Uploading one file for the whole sheet and
  matching pages to questions automatically is deferred.

### `marking`

- **Provisional mark** (`markAttempt`): runs when working is submitted, against
  the app's own worked solution. It returns:
  - score, an integer 0–100;
  - outcome, derived from the score: **full** ≥ 90, **partial** 25–89,
    **stuck** < 25 **[A]**;
  - error type, for non-full outcomes: conceptual, method, algebra slip,
    misread question, or incomplete;
  - the first wrong step (quoted or described) and feedback anchored to it;
  - short overall feedback.

  It is displayed in full with the label "AI-marked, provisional".
- **Solution lock**: the worked solution of a question is visible only if
  - the student has an attempt on it marked full, or
  - the student has revealed all three hints on it (on any attempt).

  A partial or stuck mark does not unlock it. Instead the mark screen shows
  the feedback, a button to reveal the next hint, and a "retry now" button.
  The lock is enforced on the server: a locked solution is never sent to the
  browser.
- **Dispute** (asking for a re-mark): the AI marker can be wrong, for example
  by misreading handwriting or rejecting a valid alternative method. On any
  mark, the student can press "I think this is right" and give an optional
  one-line reason. The same working is marked again with that reason as extra
  input. The result is stored as a new mark flagged as a dispute, and the
  earlier mark stays in the history. A student can do this at most twice per
  attempt, so that a mark cannot be changed by asking repeatedly. **[A]**
- **Official solutions**: the student uploads the official solutions for a
  sheet (PDF or images, same limits as a sheet). Then:
  1. `extractSolutions` produces one official solution per question.
  2. Every attempt on the sheet that has a submission is re-marked against the
     official solution. The result is a new mark with basis `official`,
     labelled "AI-marked against official solutions".
  3. Attempts whose outcome changed are flagged.
- **Current mark** of an attempt = its latest `official` mark if one exists,
  otherwise its latest `ai` mark.
- **Solutions review**: after re-marking, the student gets a review page for
  the sheet: changed marks first, then each question whose best outcome is not
  full, showing the official solution beside the student's working, with a
  "retry now" button. Official solutions follow the same solution lock, except
  that on the review page they are unlocked for every question with a
  submitted attempt. **[A]**

### `mastery`

Mastery is always computed from the attempt history by pure functions, each
time it is read. Nothing about mastery is stored, so it can never disagree
with the marks.

For one student and one topic, take every marked attempt on a question tagged
with that topic, in time order, using each attempt's current mark:

```
evidence   e = outcomeValue × hintMultiplier × timeFactor
             outcomeValue   : full 1.0, partial 0.5, stuck 0
             hintMultiplier : 1.0 / 0.85 / 0.6 / 0.35 for hint level 0 / 1 / 2 / 3
             timeFactor     : 0.9 if time spent > 2 × expected minutes, else 1.0
                              (1.0 when the attempt has no time)
weight     w = 1.0 if the current mark is official, 0.5 if provisional
mastery    m ← m + 0.3 × w × (e − m),   starting from m = 0.5
confidence c = min(1, Σw / 4) × 0.5 ^ (days since last attempt / 30)
priority   p = (1 − m) × (2 − c)
```

The constants are **[A]**. Changing them later is an "ask first" change.
Every revision item carries a human-readable reason built from this data
(for example "you used 3 hints on this in week 4").

### `history`

- **Sheet list** per course: title, upload date, questions submitted / total,
  average score, total hints revealed, total time, and whether marks are
  provisional or confirmed.
- **Sheet detail**: every question with all its attempts. Each attempt shows
  the submitted working, all its marks, the hints revealed, and time spent.
  A "try again" button starts a fresh attempt.
- **Sheet summary** (`summariseSheet`): generated when every question on the
  sheet has a submitted attempt, and regenerated after official re-marking.
  It contains what went well, what was hard, next steps, and the hint ladder
  chart.
- **Mistake log**: every attempt whose current outcome is not full, across all
  sheets of a course, filterable by topic and by error type.
- **Hand-in export**: for a sheet, one PDF containing, in question order, each
  question's label followed by the working of its most recent submitted
  attempt. Typed working is rendered with its maths; images and PDFs are
  included as uploaded. It contains no marks, hint record or AI feedback.
  Questions with no submission are listed as "not attempted".
  The PDF is assembled in the browser with `pdf-lib`: uploaded PDFs are
  merged, images are placed one per page, and typed working is captured as an
  image of its rendered preview. No server-side PDF rendering is used.

### `revision`

- The student starts a session by choosing a course, a length (20, 45 or 90
  minutes) and optionally a set of topics.
- **Retry candidates**: original questions whose most recent attempt is not
  full, or was full with hint level 2 or 3.
- **Ordering**: candidates are ranked by the highest priority among their
  topics. A candidate that is due under the spaced interval (1, 3, 7, then 14
  days after its last attempt; back to 1 day after a non-full outcome) ranks
  above one that is not yet due.
- **Queue**: fill the session length using expected minutes. About 60% of the
  time goes to retry questions and 40% to variants **[A]**. If there are too
  few retry candidates, the remainder is variants.
- **Variant** (`generateVariant`): a new question on the same topic and
  technique as a retry candidate, with a changed setup or numbers, plus its
  worked solution and three hints. A variant is stored as a question linked
  to its parent question and has the same topics.
- Questions in a session use the same attempt → hint → mark loop. Marks are
  provisional (variants have no official solution) and update mastery.
- A course with no retry candidates shows an explanation instead of an empty
  session.

### `viz`

1. **Skill map** (home screen of a course): topics as nodes, prerequisite
   links as edges, node colour = mastery, node size = number of attempts,
   reduced opacity when confidence < 0.3. Clicking a node opens its mistakes
   and a button that starts a revision session limited to that topic. A course
   with no sheets shows an upload prompt instead.
2. **Sheet heat strip**: one row per sheet, one cell per question, coloured by
   best outcome, with 0–3 dots for the hint level of that attempt.
3. **Hint ladder**: on the question screen, three rungs that fill as hints are
   revealed; on the sheet summary, a stacked bar of questions solved at hint
   level 0 / 1 / 2 / 3.
4. **Mastery over time**: one line per topic, mastery after each attempt, with
   sheet and revision-session events marked.

## Tech Stack

Versions are the latest stable at scaffold time, pinned exactly in
`package.json`. Minimum major versions are listed.

| Layer | Choice |
|---|---|
| Runtime | Node.js 22 LTS, npm |
| App | Next.js 15+ (App Router), React 19, TypeScript 5 in strict mode |
| UI | Tailwind CSS 4, shadcn/ui, KaTeX for maths; `react-markdown` with `remark-math` and `rehype-katex` to render question, hint and feedback text |
| Charts | D3 7 for the skill map; Recharts for the other three |
| Validation | Zod for all AI outputs and all request bodies |
| PDF export | `pdf-lib` and `html-to-image`, both in the browser |
| Data | PostgreSQL (Neon) through Drizzle ORM **[A]** |
| Files | S3-compatible object storage (Cloudflare R2), private bucket, signed URLs for upload and download, through `@aws-sdk/client-s3` and `@aws-sdk/s3-request-presigner` **[A]** |
| Auth | Auth.js v5: Google provider and email magic link (Resend) **[A]** |
| AI | Claude API through `@anthropic-ai/sdk`, PDF and image input, structured output |
| Hosting | Vercel **[A]** |
| Tests | Vitest (unit, contract, integration on an in-memory PGlite database), Playwright (end to end) |

### AI calls

Each call lives in `src/lib/ai/`, takes typed input, and returns output
validated by a Zod schema. Invalid output is retried once, then reported as a
failure. The model id is read from `AI_MODEL` (default `claude-sonnet-5-5`)
**[A]**. The API key is used only on the server.

| Call | Input | Output |
|---|---|---|
| `parseSheet` | sheet file, course topic list | questions (label, body, topics, expected minutes), new topics with parent and prerequisites |
| `generateHints` | question | three hints, worked solution |
| `markAttempt` | question, solution, submission, optional dispute reason | score, error type, first wrong step, feedback |
| `extractSolutions` | official solutions file, question list | one solution per question |
| `generateVariant` | parent question, its solution, the student's error on it | new question, worked solution |
| `summariseSheet` | attempts and current marks of a sheet | went well, was hard, next steps |

After `generateHints`, a check confirms that the final answer of the worked
solution does not appear in hints 1 and 2; a failing hint set is regenerated.

Long AI work (parse, hint generation, re-mark of a whole sheet) runs
server-side after the request returns, and the page polls a status field.

### Data model

- `user` (id, email, name), plus the `account`, `session` and
  `verification_token` tables that the Auth.js Drizzle adapter requires
- `course` (id, user_id, name)
- `topic` (id, course_id, name, parent_id), `topic_prereq` (topic_id, prereq_id)
- `sheet` (id, course_id, title, status: parsing | ready | failed, status_updated_at, error nullable, timer_enabled, uploaded_at, solutions_status: none | extracting | remarking | done | failed, solutions_status_updated_at, solutions_uploaded_at)
- `sheet_file` (id, sheet_id, kind: sheet | official_solutions, path, mime, position)
- `question` (id, course_id, sheet_id nullable, position, label, body, expected_minutes, source: original | variant, parent_question_id, hints_status: pending | ready | failed, hints_status_updated_at)
- `question_topic` (question_id, topic_id)
- `hint` (id, question_id, level, body)
- `solution` (id, question_id, basis: ai | official, body)
- `attempt` (id, user_id, question_id, context: sheet | revision, revision_session_id nullable, started_at, seconds_spent nullable, inherited_hint_level, difficulty_rating nullable)
- `hint_reveal` (attempt_id, hint_id, revealed_at)
- `submission` (id, attempt_id unique, text nullable, submitted_at nullable — null means draft, mark_status: none | pending | done | failed, mark_status_updated_at), `submission_file` (id, submission_id, path, mime, position)
- `mark` (id, attempt_id, basis: ai | official, score, outcome, error_type, first_wrong_step, feedback, overall_feedback, is_dispute, dispute_reason, outcome_changed, created_at)
- `sheet_summary` (sheet_id, body_json, generated_at)
- `revision_session` (id, user_id, course_id, target_minutes, topic_ids nullable, status: building | ready | failed, status_updated_at, created_at), `revision_item` (session_id, question_id, position, source: retry | variant, reason)

Unique constraints: `topic` (course_id, lower(name)); `hint` (question_id,
level); `hint_reveal` (attempt_id, hint_id); `solution` (question_id, basis);
`submission` (attempt_id).

Attempts, submitted submissions, hint reveals and marks are append-only.
There is no delete for courses or sheets in V1.

## Commands

```
Install:        npm ci
Dev server:     npm run dev                      # http://localhost:3000
Build:          npm run build
Type check:     npx tsc --noEmit
Lint:           npm run lint                     # eslint . --max-warnings 0
Format:         npx prettier --write .
Unit tests:     npm test                         # vitest run
Unit coverage:  npm test -- --coverage
One test file:  npx vitest run src/lib/mastery/mastery.test.ts
E2E tests:      npm run e2e                      # playwright test, AI_FIXTURES=1
Generate SQL:   npm run db:generate              # drizzle-kit generate
Migrate:        npm run db:migrate               # drizzle-kit migrate
```

Environment variables, listed in `.env.example` and never committed with
values: `DATABASE_URL`, `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`,
`AUTH_RESEND_KEY`, `ENABLE_TEST_SIGN_IN`, `ANTHROPIC_API_KEY`, `AI_MODEL`, `AI_FIXTURES`,
`S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

## Project Structure

```
src/app/                    Routes and route handlers
  (auth)/                     sign-in pages
  courses/[courseId]/         skill map, sheet list, mistake log
  sheets/[sheetId]/           overview, edit parse, summary, solutions review
  questions/[questionId]/     attempt screen and mark screen
  revise/                     start and run a revision session
  api/                        route handlers (uploads, AI jobs, status)
src/components/             UI components; charts in src/components/charts/
src/lib/ai/                 Claude client, one file per AI call, Zod schemas, prompts
src/lib/mastery/            Weakness model and revision queue (pure, no I/O)
src/lib/marking/            Current-mark and solution-lock rules (pure, no I/O)
src/lib/storage/            Object storage and signed URLs
src/lib/auth/               Session helper and ownership checks
src/db/                     Drizzle schema, queries, migrations in src/db/migrations/
tests/fixtures/             Recorded AI responses and sample sheets (synthetic only)
tests/e2e/                  Playwright tests
SPEC.md                     This file
tasks/                      plan.md and todo.md (created in the plan phase)
```

Unit tests sit next to the file they test as `*.test.ts`.

## Code Style

- TypeScript strict; no `any`; no non-null assertions on external data.
- Domain rules are pure functions in `src/lib/`, with no database or network
  access. Route handlers and server components load data, call them, and save.
- Named exports only. Files in kebab-case, components in PascalCase,
  functions and variables in camelCase, database columns in snake_case.
- All external data (AI output, request bodies, form data) passes through a
  Zod schema before use. Types are inferred from schemas, not written twice.
- Server components by default; `"use client"` only where interaction needs it.
- Prettier defaults; ESLint with `next/core-web-vitals`, zero warnings.
- Comments explain why, not what.

```ts
// src/lib/mastery/evidence.ts
import { z } from "zod";

export const outcomeSchema = z.enum(["full", "partial", "stuck"]);
export type Outcome = z.infer<typeof outcomeSchema>;

const OUTCOME_VALUE: Record<Outcome, number> = { full: 1, partial: 0.5, stuck: 0 };
const HINT_MULTIPLIER = [1, 0.85, 0.6, 0.35] as const;
const SLOW_FACTOR = 0.9;

export type MarkedAttempt = {
  outcome: Outcome;
  hintLevel: 0 | 1 | 2 | 3;
  secondsSpent: number | null;
  expectedMinutes: number;
};

/** Evidence in [0, 1] that the student can do this kind of question unaided. */
export function evidenceScore(attempt: MarkedAttempt): number {
  const tookTooLong =
    attempt.secondsSpent !== null &&
    attempt.secondsSpent > 2 * attempt.expectedMinutes * 60;

  return (
    OUTCOME_VALUE[attempt.outcome] *
    HINT_MULTIPLIER[attempt.hintLevel] *
    (tookTooLong ? SLOW_FACTOR : 1)
  );
}
```

## Testing Strategy

| Level | Tool | Covers | Expectation |
|---|---|---|---|
| Unit | Vitest | `src/lib/mastery/`, `src/lib/marking/` (evidence, mastery replay, priority, queue building, current mark, solution lock, outcome thresholds) | 100% line coverage of these two folders |
| Contract | Vitest | Each AI call: recorded fixture responses parse against the Zod schema; invalid output triggers one retry then a failure; hint-leak check | Every AI call has a passing and a failing fixture |
| Integration | Vitest on in-memory PGlite with the real migrations | Ownership: each `require…` helper rejects another user's ids | One test per helper |
| End to end | Playwright | The flows listed under Success Criteria, with `AI_FIXTURES=1` so that AI calls return recorded responses | All pass before the demo |
| Manual | — | Real AI calls on three real sheets and on handwriting photos of good, average and poor quality | Checked once per module that uses AI |

Google sign-in cannot be automated, so a **test sign-in** exists for Playwright
and for agents checking their work: it signs in as a named test user without
Google. It works only when `NODE_ENV` is not `production` and
`ENABLE_TEST_SIGN_IN=1`; this variable is never set on Vercel.

Tests never call the real Claude API. Fixtures contain synthetic sheets and
working only, never real student uploads. `npm run lint`, `npx tsc --noEmit`
and `npm test` must pass before every commit.

## Boundaries

- **Always:**
  - filter every read and write by the signed-in user;
  - record every hint reveal, attempt, submission and mark;
  - label every mark as AI-marked, and as provisional until official solutions exist;
  - validate AI output and request bodies with Zod;
  - enforce the solution lock on the server;
  - keep API keys and storage credentials on the server;
  - run lint, type check and unit tests before a commit.
- **Ask first:**
  - changing the database schema once real data exists;
  - adding a dependency not listed under Tech Stack;
  - changing the mastery constants, outcome thresholds or solution-lock rule;
  - changing an AI output schema;
  - moving an item from "Out of Scope (Deferred)" into V1.
- **Never:**
  - put the final answer in hint 1 or 2;
  - send a locked worked solution to the browser;
  - expose one user's files, working or marks to another user;
  - update or delete an attempt, submission, hint reveal or mark;
  - commit secrets, `.env` files or uploaded student work;
  - call the real Claude API from automated tests;
  - enable the test sign-in in production;
  - remove or skip a failing test without approval.

## Success Criteria

All of V1 must work live in the hackathon demo, with real AI calls and no
seeded or mocked data.

`accounts`
1. A new user can sign in with Google and with an email magic link.
2. A signed-in user requesting another user's sheet, question, attempt or file
   URL receives "not found".

`sheets`
3. A typeset 10-question PDF sheet reaches status `ready`, with every question
   listed, rendered with KaTeX and tagged with 1–3 topics, within 60 seconds
   of upload.
4. The student can edit a question's text and topics, and merge, split and
   delete unattempted questions; the change persists after reload.
5. All three hints exist for every question within 120 seconds of upload.

`attempts`
6. Hints can only be revealed in order, and each reveal is stored with a
   timestamp.
7. Working can be submitted as images, as a PDF and as typed LaTeX; each kind
   is viewable afterwards in sheet detail.
8. The timer pauses when the tab loses focus, and can be switched off for a sheet.

`marking`
9. A submission receives a score, outcome, error type and step-anchored
   feedback within 45 seconds, shown with the label "AI-marked, provisional".
10. With fewer than three hints revealed and no full-outcome attempt, the
    worked solution is absent from every server response for that question.
    After a full outcome, or after the third hint, it is shown.
11. After a partial or stuck mark, the mark screen offers the next hint and a
    retry; the retry creates a new attempt and the earlier one is unchanged.
12. A dispute creates a new mark and leaves the earlier mark in the history.
13. After the official solutions are uploaded, every submitted attempt on the
    sheet has an `official` mark, changed outcomes are flagged, and the review
    page shows the official solution beside the student's working.

`mastery`
14. Unit tests show: a full, unhinted attempt raises mastery; a stuck attempt
    lowers it; the same outcome moves mastery less at hint level 3 than at
    level 0; an official mark moves mastery twice as far as a provisional one;
    confidence halves after 30 days without attempts.

`history`
15. Any past sheet can be reopened to show every attempt with its working,
    marks, hints revealed and time, plus the sheet summary.
16. The mistake log filters by topic and by error type.
17. The hand-in export downloads one PDF with every submitted question's
    working in order, and contains no mark, hint or feedback text.

`revision`
18. A 20-minute session on a course with past mistakes contains at least one
    retry question and at least one variant, ordered by priority, each with a
    stated reason.
19. A variant differs from its parent question, has three hints and a worked
    solution, and can be attempted and marked.
20. Completing a revision question changes the mastery of its topics.

`viz`
21. The skill map shows every topic of the course with colour by mastery, and
    a click on a node opens that topic's mistakes.
22. The heat strip, hint ladder and mastery-over-time charts render from real
    data and update after a new mark without a manual refresh of the data.

## Assumptions

Each of these was not stated by you. Correct any of them before approval.

1. One spec file with an embedded capability map, instead of one spec per module.
2. Upload limits: PDF 20 MB / 30 pages; images JPEG, PNG or WebP, 10 MB each,
   10 per upload. HEIC is not accepted.
3. A question with sub-parts is attempted and marked as one unit.
4. The topic tree and prerequisite links are proposed by the parser from the
   sheets themselves, since syllabus import is deferred.
5. Outcome is derived from the score: full ≥ 90, partial 25–89, stuck < 25.
6. A "retry now" keeps revealed hints visible; attempts from history or
   revision start with hints hidden.
7. At most two disputes per attempt.
8. On the solutions review page, official solutions are unlocked for every
   question that has a submitted attempt.
9. Mastery constants: learning rate 0.3, provisional weight 0.5, slow-attempt
   factor 0.9, confidence half-life 30 days, start value 0.5.
10. Revision sessions are about 60% retry and 40% variant by time.
11. Providers: Neon (Postgres), Cloudflare R2 (files), Resend (magic-link
    email), Vercel (hosting); default model `claude-sonnet-5-5`.

## Out of Scope (Deferred)

| Item | Why deferred |
|---|---|
| Subjects other than maths | V1 prompts and marking are tuned for maths only |
| Native mobile app | The responsive web app covers phone use in V1 |
| Deleting courses or sheets | Not needed for the loop; avoids deleting history |
| Tutor or class view; tutor-entered marks | V1 is single-student; confirmed decision |
| Shared class sheets, join by code, reuse of one parse across students | Each student uploads their own in V1; confirmed decision |
| Per-user AI usage limits | Not needed for the demo; confirmed decision |
| Probe questions on stale or untested topics | Needs a topic list beyond what sheets provide |
| Exam date, exam-proximity weighting, review schedule, forgetting forecast | Depends on exam-date scheduling |
| Mock exam builder | Builds on revision; not needed for the core loop |
| Whole-sheet upload of working with automatic page-to-question matching | Extra AI step; per-question upload is enough for V1 |
| Phone capture by QR code | Convenience only |
| Syllabus import to seed the topic tree | Topics come from the parser in V1 |
| "What I tried" prompt before hints; "check my approach"; explain-back after hint 3 | Hints are exactly three fixed levels in V1 |
| Error-type-specific advice | Needs content per error type |
| Visualisations: mistake fingerprint, time vs outcome scatter, exam readiness dial, annotated working, calibration chart | V1 ships four visualisations |
| Streaks and "redeemed" markers | Motivation layer, after the loop is proven |
| Export of the mistake log as PDF or Anki deck | Hand-in export is the only export in V1 |
| Authoritative grading, proctoring, cheating detection | Marks are formative feedback only; never planned |
| Free-form tutoring chat | Would bypass the hint ladder and solution lock |

## Open Questions

None.
