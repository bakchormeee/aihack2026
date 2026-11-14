# Implementation Plan: Problem Sheet Companion — V1

Source spec: [SPEC.md](../SPEC.md) (approved 14 November 2026, amended after audit)
Task list: [todo.md](todo.md)
Plan version: 2 (rewritten after a parallel-safety audit)

## Overview

Build a responsive Next.js web app in which a student uploads a maths problem
sheet, attempts each question with up to three hints, submits working,
receives an AI mark, later confirms marks against official solutions, and
revises from their weakest topics. The repository contains only the spec, so
work starts from an empty scaffold. The demo is 12 hours away.

The plan is built for several agents working at once. It has three parts
that make that safe: **frozen files** that only the foundation tasks write,
**contracts** (function signatures, routes, URLs) fixed here before any code,
and **one owner per file** for every task.

## Audit findings and how the plan answers them

| # | Problem in plan v1 | Consequence | Fix in this plan |
|---|---|---|---|
| 1 | Uploads were posted through the server | Vercel rejects request bodies above about 4.5 MB; a 20 MB PDF would fail only after deployment | Browser uploads directly to R2 with a signed URL; server verifies afterwards (decision 5) |
| 2 | Phone photos sent to the AI unchanged | Photos of 5–10 MB exceed the per-image and per-request input limits; marking fails on real photos | Images are resized in the browser before upload (spec amended) |
| 3 | Attempt created when the question page renders | Next.js link prefetch renders pages early, so attempts and timers would be created for questions never opened | Attempt is opened by an idempotent action called from the browser (contract C4) |
| 4 | Mastery refresh hooked into marking | Marking (one track) and mastery (another track) had to edit each other's code | Mastery is computed on read; no cache table, no hook (spec amended) |
| 5 | Several tracks edited the same page files (course page, sheet page, question page) | Merge conflicts between parallel agents | Every view has its own route; all routes exist as placeholders after F3; each task replaces only its own page |
| 6 | `package.json`, lockfile and schema edited by many tasks | Lockfile and migration conflicts | F1 installs every dependency; F2 creates the whole schema; both are frozen afterwards |
| 7 | Agents could not sign in to check their work | Google sign-in cannot be automated; Playwright test impossible | Test sign-in outside production only (spec amended) |
| 8 | Integration tests had no database | "Two-user" ownership tests could not run | In-memory PGlite with the real migrations (F2) |
| 9 | Auth middleware plus database sessions | Middleware runs on the edge runtime, where the database adapter does not work | No middleware; a guard in the `(app)` layout and `requireUser()` in every action |
| 10 | Auth.js tables missing from the data model | Sign-in fails at the first request; magic link needs a later schema change | Adapter tables included in F2 |
| 11 | No status for marking, official re-mark or session building | Pages could not show progress or offer a retry; stuck jobs invisible | Status columns added (spec amended); stale `pending` older than 3 minutes shows a retry |
| 12 | Background jobs could start twice | Duplicate questions, hints or marks | Each job claims its row with a conditional status update before working (decision 4) |
| 13 | Ten or more AI calls started at once | Rate-limit errors during hint generation and re-marking | Concurrency limit of 5 through one helper |
| 14 | Editing a question's text after attempts | Regenerated hints would orphan recorded hint reveals | Body is locked once an attempt exists (spec amended) |
| 15 | Two sheets parsed at once could create the same topic twice | Duplicate nodes on the skill map | Unique index on (course, lower(name)) and upsert |
| 16 | T5 and T12 were too large; several tasks had "and" in the title | Unreliable agent output | Split; no task now owns more than 5 files |
| 17 | AI modules, pure rules and charts waited behind the UI | 5 hours of purely sequential work | They depend only on the foundation and now run in parallel from the start |
| 18 | T23 depended on tasks in two other tracks without saying so | Hidden blocking | Cross-track links are plain URLs fixed in contract C6 |
| 19 | Every agent ticked boxes in `todo.md` | Constant conflicts in one file | Only the coordinator edits `tasks/` |
| 20 | Agents sharing one folder | Clashing `.next` builds, ports and uncommitted edits | One git worktree and one port per track |
| 21 | Dependencies used but not in the spec's stack | Violates the spec's "ask first" rule mid-build | Full list added to the spec and installed in F1 |
| 22 | Draft working was undefined | "Submit all" had nothing to submit | Draft submission defined (spec amended) |
| 23 | External setup details missing | OAuth redirect, R2 CORS and consent-screen errors found late | T0 lists every setting |

## Spec amendments made by this audit

All are in SPEC.md now. None changes what the student can do, except the
body lock (14).

1. Platform stated: responsive web app, usable at 375 px; no native app.
2. Images resized in the browser; uploads go directly to storage.
3. Question body cannot be edited once the question has an attempt.
4. Draft submissions; one submission per attempt.
5. Mastery computed on read; `topic_mastery` table removed.
6. Data model: Auth.js tables, status columns, unique constraints.
7. Test sign-in outside production; "never enable in production" boundary.
8. Stack: Markdown rendering packages, S3 SDK, PGlite.
9. Deferred: native mobile app; deleting courses or sheets.

## Architecture Decisions

1. **Foundation first, then parallel tracks.** F1–F5 are the only horizontal
   tasks. After them, every task is a slice with its own files.
2. **Frozen files.** After the foundation, these are read-only for all
   tracks: `package.json`, `package-lock.json`, all config files,
   `src/db/schema.ts`, `src/db/migrations/`, `src/db/index.ts`,
   `src/lib/domain.ts`, `src/lib/auth/`, `src/lib/storage/`,
   `src/lib/ai/client.ts`, `src/lib/concurrency.ts`,
   `src/components/ui/`, `src/components/math-text.tsx`,
   `src/components/upload-dropzone.tsx`, and every `layout.tsx`.
   An agent that needs a change in a frozen file stops and reports to the
   coordinator; it does not edit the file.
3. **Server actions for mutations; route handlers only for signed URLs and
   status polling.** Actions live in an `actions.ts` beside the page that
   uses them.
4. **Background work uses `after()` from `next/server`** with
   `maxDuration = 300`. Each job lives in `src/lib/pipeline/<job>.ts`.
   A job first claims its row with a conditional update (for example
   `UPDATE submission SET mark_status = 'pending' WHERE id = ? AND
   mark_status IN ('none','failed')`) and does nothing if no row was
   claimed. On error it sets the status to `failed`. Pages poll every 2
   seconds; a `pending`/`parsing`/`building` status older than 3 minutes is
   shown as failed with a retry button.
5. **Uploads go from the browser directly to R2.** `POST
   /api/uploads/presign` returns a signed PUT URL for a key the server
   chooses (`u/<userId>/<purpose>/<parentId>/<uuid>.<ext>`). The browser
   uploads, then calls a server action with the key. The action checks the
   key prefix against the signed-in user and reads the object's size and
   type from storage before saving a row. Downloads use
   `GET /api/files/sheet/[id]` and `GET /api/files/submission/[id]`, which
   check ownership and redirect to a signed URL valid for 5 minutes.
6. **One AI wrapper.** `callAi` validates output with Zod, retries once,
   and in fixture mode (`AI_FIXTURES=1`) returns
   `tests/fixtures/ai/<callName>.json`. Callers pass file bytes; AI modules
   never touch storage or the database.
7. **Rules are pure functions** in `src/lib/marking/` and
   `src/lib/mastery/`, written test-first, with no I/O.
8. **Mastery is computed on read** by `getCourseMastery`. No write path
   depends on it.
9. **Staleness is computed, not signalled.** The sheet summary regenerates
   when its `generated_at` is older than the sheet's newest mark. No track
   has to notify another.
10. **Ownership helpers** in `src/lib/auth/ownership.ts` return the row or
    throw "not found". Every action and page loads through them.
11. **Worked solutions reach the browser only through
    `getVisibleSolution()`** in `src/db/queries/marking.ts`.
12. **No auth middleware.** The `(app)` route-group layout calls
    `requireUser()`; every action and route handler calls it again.
13. **Charts take plain props.** Each chart is built and checked against
    sample data on a development-only page, then wired to real data by a
    separate task.
14. **Deploy early.** The app is deployed after F3 and at every checkpoint.

## Contracts

These are fixed. A task may add to its own files but may not change a
signature here without the coordinator.

### C1 Domain types — `src/lib/domain.ts` (F2)

```ts
export const OUTCOMES = ["full", "partial", "stuck"] as const;
export const ERROR_TYPES = ["conceptual", "method", "algebra_slip", "misread_question", "incomplete"] as const;
export const MARK_BASES = ["ai", "official"] as const;
export type Outcome = (typeof OUTCOMES)[number];
export type ErrorType = (typeof ERROR_TYPES)[number];
export type MarkBasis = (typeof MARK_BASES)[number];
export type HintLevel = 0 | 1 | 2 | 3;
```

The Drizzle enums in `schema.ts` are built from the same arrays.

### C2 AI calls — `src/lib/ai/` (A1–A7)

```ts
type AiFile = { mime: string; data: Buffer };

callAi<T>(args: { callName: string; schema: z.ZodType<T>; system: string;
                  text: string; files?: AiFile[] }): Promise<T>

parseSheet(i: { files: AiFile[]; existingTopics: string[] }): Promise<{
  questions: { label: string; body: string; topics: string[]; expectedMinutes: number }[];
  newTopics: { name: string; parent: string | null; prerequisites: string[] }[] }>

generateHints(i: { questionBody: string }): Promise<{
  hints: [string, string, string]; solution: string; finalAnswer: string }>

markAttempt(i: { questionBody: string; solution: string;
                 working: { text: string | null; files: AiFile[] };
                 disputeReason?: string }): Promise<{
  score: number; errorType: ErrorType | null; firstWrongStep: string | null;
  feedback: string; overallFeedback: string }>

extractSolutions(i: { files: AiFile[];
                      questions: { id: string; label: string; body: string }[] }): Promise<{
  solutions: { questionId: string; body: string }[] }>

generateVariant(i: { parentBody: string; parentSolution: string;
                     errorSummary: string | null }): Promise<{
  body: string; solution: string; finalAnswer: string;
  hints: [string, string, string]; expectedMinutes: number }>

summariseSheet(i: { items: { label: string; topics: string[]; outcome: Outcome;
                             hintLevel: HintLevel; errorType: ErrorType | null;
                             feedback: string }[] }): Promise<{
  wentWell: string[]; wasHard: string[]; nextSteps: string[] }>

hintsLeakAnswer(hints: string[], finalAnswer: string): boolean   // generate-hints.ts
```

`generateHints` and `generateVariant` regenerate once inside the module when
`hintsLeakAnswer` is true for hints 1–2. The outcome is not returned by the
AI; it is derived from the score by `outcomeFromScore`.

### C3 Pure rules — `src/lib/marking/rules.ts` (L1), `src/lib/mastery/` (L2, L3)

```ts
outcomeFromScore(score: number): Outcome                      // ≥90 full, 25–89 partial, <25 stuck
currentMark<M extends { basis: MarkBasis; createdAt: Date }>(marks: M[]): M | null
attemptHintLevel(inherited: HintLevel, revealedLevels: number[]): HintLevel
isSolutionUnlocked(i: { hasFullAttempt: boolean; maxHintLevelRevealed: HintLevel;
                        reviewMode: boolean; hasSubmittedAttempt: boolean;
                        hasOfficialSolution: boolean }): boolean
canDispute(disputeCount: number): boolean                     // < 2

type MarkedAttempt = { at: Date; outcome: Outcome; hintLevel: HintLevel;
                       secondsSpent: number | null; expectedMinutes: number; basis: MarkBasis };
evidenceScore(a: MarkedAttempt): number
replayMastery(attempts: MarkedAttempt[], now: Date): {
  mastery: number; confidence: number; priority: number; attempts: number;
  series: { at: Date; mastery: number }[] }

type Candidate = { questionId: string; topicIds: string[]; expectedMinutes: number;
                   lastAttemptAt: Date; lastOutcome: Outcome; lastHintLevel: HintLevel;
                   consecutiveFull: number; label: string };
buildQueue(i: { candidates: Candidate[]; priorityByTopic: Record<string, number>;
                targetMinutes: number; now: Date }): {
  items: { source: "retry" | "variant"; questionId: string; reason: string }[] }
```

For a `variant` item, `questionId` is the parent question.

### C4 Attempt and marking actions and queries (M6–M10)

```ts
// src/app/(app)/questions/[questionId]/actions.ts
openAttempt(i: { questionId: string; sessionId?: string }): Promise<{ attemptId: string }>
  // idempotent: returns the open attempt (no submitted submission) or creates one
startAttempt(i: { questionId: string; mode: "retry-now" | "fresh"; sessionId?: string }):
  Promise<{ attemptId: string }>   // retry-now inherits revealed hints; fresh hides them
revealNextHint(i: { attemptId: string }): Promise<{ level: 1 | 2 | 3; body: string }>

// src/lib/pipeline/mark.ts
runMark(i: { submissionId: string; basis: MarkBasis; disputeReason?: string }): Promise<void>

// src/db/queries/marking.ts
getVisibleSolution(userId: string, questionId: string, o?: { reviewMode?: boolean }):
  Promise<{ basis: MarkBasis; body: string } | null>

// src/lib/navigation.ts
getNextHref(i: { questionId: string; sessionId?: string }): Promise<string>
```

The question and mark pages read an optional `?session=<id>` query
parameter and pass it through, so that a revision session reuses them
without editing them.

### C5 Mastery query — `src/db/queries/mastery.ts` (V1)

```ts
getCourseMastery(userId: string, courseId: string): Promise<{
  topics: { id: string; name: string; parentId: string | null; mastery: number | null;
            confidence: number; priority: number; attempts: number;
            series: { at: Date; mastery: number }[] }[];
  prereqs: { topicId: string; prereqId: string }[] }>
```

### C6 Routes and cross-track links

All pages are inside `src/app/(app)/` except the landing and sign-in pages.
F3 creates every page below as a placeholder; the owner replaces it.

| Route | Owner |
|---|---|
| `/courses` | M1 |
| `/courses/[courseId]` (skill map, course home) | V4 |
| `/courses/[courseId]/sheets` | M2, then H1, H5 |
| `/courses/[courseId]/mistakes` (accepts `?topic=`, `?error=`) | H3 |
| `/courses/[courseId]/progress` | V5 |
| `/sheets/[sheetId]` (overview) | M3 |
| `/sheets/[sheetId]/edit` | M5, M5b |
| `/sheets/[sheetId]/history` | H1, H4 |
| `/sheets/[sheetId]/summary` | H2 |
| `/sheets/[sheetId]/solutions` | R1, R2 |
| `/questions/[questionId]` (accepts `?session=`) | M6–M8 |
| `/questions/[questionId]/mark` (accepts `?attempt=`, `?session=`) | M9, M10, then R3 |
| `/revise` (accepts `?course=`, `?topic=`) | V2 |
| `/revise/[sessionId]` | V3 |
| `/dev/charts/<name>` (404 in production) | C1–C4 |

Course tabs and sheet tabs are in the two `layout.tsx` files from F3 and
already link to every route above.

### C7 Chart props — `src/components/charts/` (C1–C4)

```ts
HintRungs        { revealed: HintLevel }
HintLadderBar    { counts: [number, number, number, number] }          // solved at level 0..3
SkillMap         { nodes: { id: string; name: string; mastery: number | null;
                            confidence: number; attempts: number }[];
                   links: { source: string; target: string }[];
                   hrefForTopic: (topicId: string) => string }
HeatStrip        { rows: { sheetId: string; title: string;
                           cells: { label: string; outcome: Outcome | null; hintLevel: HintLevel }[] }[] }
MasteryOverTime  { topics: { id: string; name: string; series: { at: string; mastery: number }[] }[];
                   events: { at: string; kind: "sheet" | "revision"; label: string }[] }
```

### C8 Query files

One file per owner: `src/db/queries/courses.ts` (M1), `sheets.ts` (M2–M5),
`attempts.ts` (M6–M8), `marking.ts` (M9, M10, then track R), `history.ts`
(track H), `mastery.ts` (V1), `revision.ts` (V2, V3). A task that needs a
query in another owner's file writes its own query in its own file.

## Tracks and dependency graph

```
T0 (you) ─────────────────────────────────────────────┐
F1 scaffold ─ F2 schema+types ─┬─ F3 auth+shell ─┬─ F5 storage
                               ├─ F4 ownership ──┘
                               │
   Track AI     (after F2):  A1 ─ A2, A3, A4, A5, A6, A7        (A2–A7 independent)
   Track Logic  (after F2):  L1,  L2 ─ L3
   Track Charts (after F1):  C1, C2, C3, C4                     (independent)
   Track Main   (after F3–F5):
        M1 ─ M2 ─ M3 ─ M4 ─┬─ M5 ─ M5b
              (A2) (A3)    └─ M6 ─ M7 ─ M8 ─ M9 ─ M10 ─ M11     ← core loop
                             (L1,C1)        (A4,L1)
   After M10, three tracks:
        Track R:  R1 ─ R2 ─ R3                      (A5)
        Track H:  H1 ─┬─ H2 (A7, C1)
                      ├─ H3
                      ├─ H4
                      └─ H5 (C3)
        Track V:  V1 ─┬─ V2 ─ V3                    (L2, L3, A6)
                      ├─ V4 (C2)
                      └─ V5 (C4)
   Z1 demo readiness (after everything not cut)
```

Up to four agents can work before the core loop (Main, AI, Logic, Charts)
and up to four after it (R, H, V-revision, V-charts).

## Rules for parallel agents

1. **One worktree per track**, on branch `track/<name>`, created from `main`
   after the foundation is merged. Each worktree runs `npm ci`, gets a copy
   of `.env.local`, and uses its own port (Main 3000, AI 3001, Logic 3002,
   Charts 3003; later R 3001, H 3002, V 3003).
2. **Write only the files listed for your task.** New files are allowed
   only inside the folders your task lists. Frozen files are never edited.
3. **Never edit `tasks/` or `SPEC.md`.** Report completion to the
   coordinator, who ticks the box.
4. **One commit per task**, with the task id in the message. Before
   reporting, run `npm run lint`, `npx tsc --noEmit` and `npm test` in the
   worktree.
5. **Sign in with the test sign-in**, using a user name unique to the track
   (for example `track-h@test.local`), so that tracks sharing the
   development database do not see each other's data.
6. **The development database schema is changed only by F2.**
7. **Coordinator merges** each track into `main` at the checkpoints in
   todo.md, runs the checks and the build on `main`, and deploys.
8. **A blocked agent stops and reports**; it does not work around a
   contract.

## Coordinator and branches

Status: plan approved by the user on 14 November 2026.

- **One coordinator session** (the Claude Code session that wrote this
  plan). It does F1 and F2 itself, starts one agent session per track in its
  own worktree, and is the only session that merges into `main`, pushes,
  ticks tasks in `todo.md` and edits `SPEC.md`.
- **Track agents** receive this brief: "Read `tasks/plan.md` (rules for
  parallel agents, contracts) and do tasks `<ids>` from `tasks/todo.md` in
  order, on branch `track/<name>`. One commit per task. Do not push. Report
  when done or blocked."
- **Branches.** The repository's only branch today is
  `claude/affectionate-johnson-qxeuy6`. Before F1, the coordinator creates
  `main` from it and pushes it, and the user makes `main` the default branch
  on GitHub. Track branches stay local; only `main` is pushed.
- **Deployment.** Vercel is connected to the GitHub repository with `main`
  as the production branch, so each push to `main` at a checkpoint deploys.
- One orchestration tool only. If the tracks are run from another tool
  instead, the same brief, branch names and rules apply, and this session
  still does the merging.

## Time budget

| Stage | Tasks | Clock (hours from start) |
|---|---|---|
| Foundation | T0, F1–F5 | 0 – 1.25 |
| Parallel build | Main M1–M11; AI, Logic, Charts alongside | 1.25 – 5.0 |
| Checkpoint: core loop on Vercel | | 5.0 |
| Parallel tracks | R, H, V | 5.0 – 8.5 |
| Checkpoint: all modules merged | | 8.5 |
| Demo readiness | Z1 | 8.5 – 10 |
| Reserve | | 10 – 12 |

If the core-loop checkpoint is later than hour 6, apply the cut order at once.

## Cut order (from the spec)

1. F3b email magic link
2. M5b merge and split
3. Playwright tests beyond M11
4. V5 mastery-over-time chart (and C4)
5. R3 dispute
6. H5 sheet heat strip (and C3)
7. H4 hand-in export

## Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Twelve hours is too short | High | Parallel tracks from hour 1.25; fixed checkpoints; cut order; 2-hour reserve |
| T0 not finished when F3 needs it | High | F1, F2, F4 and tracks AI, Logic, Charts need no keys except `ANTHROPIC_API_KEY` for manual AI checks |
| Parsing slow or wrong on real sheets | High | A2 is checked with a real sheet in the first two hours; editable parse |
| Claude API details differ from what the plan assumes (limits, structured output, model ids) | High | A1 must read the current API documentation before writing `callAi` and record the limits it found in `src/lib/ai/README.md` |
| LaTeX backslashes corrupted in JSON output | Medium | Every AI fixture contains LaTeX with backslashes; A1 has a round-trip test |
| Handwriting misread | Medium | Manual test with three photo qualities in M9; "provisional" label; dispute |
| Background work cut off on Vercel | Medium | `maxDuration = 300`; concurrency 5; stale-status retry button |
| Library versions newer than the agent's knowledge (Next.js, Auth.js) | Medium | F1 and F3 read the installed version's documentation; no middleware, which removes the largest version-specific difference |
| Merge conflicts between tracks | Medium | Frozen files, one owner per file, placeholder routes, coordinator-only `tasks/` |
| Variants unsolvable or too similar | Medium | Solution generated in the same call; manual check in V2 |
| Skill map layout takes too long | Medium | C2 uses a default force layout; fallback is a grid of topic cards with the same props |
| Test sign-in reachable in production | High | Double guard (`NODE_ENV` and flag); Z1 verifies the route returns 404 on Vercel |
| Google consent screen in testing mode blocks demo users | Medium | T0 publishes the app or adds the demo accounts as test users |

## Open Questions

None. The user will supply three real sheets with official solutions by
about hour 2; they are kept outside the repository.
