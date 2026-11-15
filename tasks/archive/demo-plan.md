# Implementation Plan: Demo account for hackathon judges

Source spec: [SPEC-demo.md](../SPEC-demo.md) · Tasks: [todo.md](demo-todo.md)


## Context

The approved delta spec [SPEC-demo.md](../SPEC-demo.md) asks for a single open link,
`/demo`, that drops a judge into a private copy of a prepared student, with no sign-in.
The student has three weeks of real work on the sheets in `Sample Problem Sheets/`:
mixed marks, recurring mistakes, and finished revision sessions. Each copy expires after
24 hours, there are at most 200 copies, and each may make at most 30 AI calls.

**First step after approval (planning files only, one commit):**
- move the spaced-review plan to `tasks/archive/spaced-review-plan.md` and `-todo.md`;
- write the new `tasks/plan.md` and `tasks/todo.md` from this plan, carrying over the
  open items (the live spot-the-error check, C1 and C2);
- mark SPEC-spaced-review.md "implemented".

## What the code looks like today (from reading it)

| Area | Where | Today |
|---|---|---|
| Auth | `src/lib/auth/config.ts` (frozen; coordinator edits): Google, plus a Credentials provider `test` that is off in production. JWT sessions, so a Credentials provider works | A second Credentials provider, `demo`, fits here |
| Session | `requireUser()` (`src/lib/auth/session.ts`), with the app layout `src/app/(app)/layout.tsx` (header with Sign out) | The banner goes in this layout |
| Sign-in and landing | `src/app/(auth)/sign-in/page.tsx` (server action calling `signIn`), `src/app/page.tsx` | They get "Try the demo" |
| AI | Every AI call goes through `callAi` (`src/lib/ai/client.ts`). The callers are 9 wrappers, run by these pipelines: `runParse`, `runHints`/`runHintsForSheet`, `performMark`, `performOfficialRemark`, `buildRevisionSession`, `buildSpotSession`, `answerSpotItem`, `refreshMisconceptions`, and the sheet summary | One choke point for counting calls |
| Files | Keys are `u/<userId>/<purpose>/…` (`src/lib/storage/keys.ts`); `deleteObject` is in `s3.ts`; there is no server-side upload helper | A copy keeps the template's paths; erasing deletes only keys under the copy's own `u/<copyId>/` |
| History FKs | `attempt.user_id` cascades from `user`, but `hint_reveal`, `submission`, `submission_file`, `mark` and `revision_item` have no cascade | Erasing a copy deletes in explicit order |
| Existing seed | `scripts/seed-mastery.ts` (dev-only direct inserts) | A pattern for the template script |

## Architecture decisions

1. **Demo identity lives on `user` (migration E):**
   - `demo_role` (null for real users, `template` or `copy`);
   - `demo_expires_at`;
   - `demo_ai_calls` (integer, default 0).

   The template user (`demo-template@demo.invalid`) has no linked account, and the demo
   provider never returns it, so it cannot be signed in to.
2. **Pure rules in `src/lib/demo/rules.ts`, with 100% coverage:**
   - the time shift (the newest template activity maps to now);
   - expiry;
   - which copies to erase to stay at or under 200;
   - the AI limit (30).
3. **Copying is one transaction in `src/db/queries/demo.ts`.** `createDemoCopy(now)`
   reads every row the template owns (about 20 tables), gives each a new id through id
   maps, and shifts every timestamp by the same amount. Self-links are remapped:
   `parent_question_id`, `parent_id`, prereqs, misconception sources, spot items. Files
   keep their template paths.

   `eraseDemoCopy(userId, io={deleteObject})` deletes in FK order and then deletes R2
   keys under `u/<copyId>/` only. `eraseExpiredDemoCopies(now)` also enforces the
   200-copy cap.
4. **Demo sign-in.**
   - A Credentials provider `demo` with no fields. Its `authorize()` creates a copy and
     returns it.
   - `/demo` is a page. If the visitor is already signed in to a live copy, it redirects
     to `/courses`. Otherwise it renders a tiny client form that submits itself at once
     to a server action calling `signIn("demo", { redirectTo: "/courses" })`.
   - So there is no sign-in page, and crawlers that don't run JavaScript never create
     copies.
   - Opening `/demo` also starts `after(() => eraseExpiredDemoCopies())`.
5. **The AI limit has one enforcement point.** `src/lib/ai/budget.ts` uses
   `AsyncLocalStorage`: `withAiUser(userId, fn)` wraps the body of each pipeline entry
   point listed above, and the pipelines already know the user.

   `callAi` reads the current user. For a demo copy it reserves a call with one
   conditional UPDATE (`demo_ai_calls < 30`), or throws `AiLimitError`.

   Each server action that starts AI work first calls `demoAiRefusal(user)` and returns
   the spec's message. That covers submitting working, disputes, uploading a sheet or
   official solutions, starting a revision or spot-the-error session, a spot answer, and
   the retry buttons.
6. **The template script** (`scripts/build-demo.ts`, run with `tsx`) uses the real
   pipeline functions and the real AI, plus one script-only AI call, `writeDemoWorking`.
   That call writes a student's typed answer that reaches a target outcome and shows a
   chosen misconception.

   A pure, tested `planDemoHistory()` decides the history from a fixed seed:
   - which questions are attempted;
   - each one's target outcome (about 40% full, 35% partial, 25% stuck);
   - which misconception each shows;
   - which hints are revealed;
   - the day of each attempt over 21 days.

   The script then:
   1. uploads the PDFs to R2 through a new `putObject`;
   2. parses the sheets and generates hints;
   3. submits and marks the working;
   4. uploads the official solutions for sheets 1–2, which re-marks the answers;
   5. backdates the template's rows to the planned days;
   6. builds and answers one long-form session and one 5-question spot session.

   Running it again first erases the old template.

   Backdating writes timestamps of template rows only, inside a dev script. This is a
   deliberate, contained exception to "attempts and marks are append-only", which app
   code still never breaks.

## Dependency graph

```
E1 migration E + rules ─┬─► E2 copy + erase ─► E3 demo sign-in, /demo, banner, buttons
                        └─► E4 AI limit (budget + pipeline wrapping + action refusals)
E2 ─► E5 template script (planDemoHistory, putObject, writeDemoWorking)
E3 + E4 + E5 ─► E6 end-to-end + build ─► E7 release (your go-ahead: migrate, push, build template)
```

E4 and the independent parts of E5 (planDemoHistory, writeDemoWorking, putObject) touch
different files and are built in parallel worktrees while E2 and E3 are built here.

## Tasks

Every task is built test first, then code, and gets one commit that names its files.
"Checks" means `npm run lint`, `npm run typecheck` and `npm test`.

### Phase 1: Copies (about 2 h)

- **E1: Migration E and demo rules** (S–M)
  - Acceptance:
    - The three new `user` columns exist, and existing users read as real.
    - `timeShift`, `isExpired`, `copiesToErase(copies, now, max=200)` and `aiCallsLeft`
      cover every case, including exactly at 24 hours and exactly at 200 copies.
  - Verify: checks; the migration test; 100% coverage with `src/lib/demo` added.
  - Files: `src/db/schema.ts`, `src/db/migrations/0004_*.sql` (+ meta), `src/db/migrations.test.ts`, `src/lib/demo/rules.ts` (+ test), `vitest.config.mts`

- **E2: Copy and erase** (M)
  - Acceptance:
    - `createDemoCopy` copies every row type the spec lists, with new ids.
    - Links are intact: a variant points at the copied parent, a misconception source
      at the copied mark, a spot item at the copied session.
    - Times end at now, and file paths are unchanged.
    - Two copies are independent, and the template is untouched.
    - `eraseDemoCopy` removes every row and deletes only `u/<copyId>/` keys.
    - `eraseExpiredDemoCopies` erases expired copies and enforces the cap.
    - It never touches the template or a real user.
  - Verify: checks; integration tests on a small hand-made template (every table, a
    dispute, a variant, a spot session) with a fake `deleteObject`.
  - Files: `src/db/queries/demo.ts` (+ test)

- **E3: Demo sign-in, `/demo`, banner, buttons** (M)
  - Acceptance:
    - The `demo` provider creates a copy and returns its user. It is never the template.
    - `/demo` reuses a live copy and creates one otherwise. It starts the erase in
      `after()`.
    - The banner, with **Start again**, shows on every app page for a copy only.
    - "Try the demo" appears on the landing and sign-in pages.
    - The `test` provider stays off in production.
  - Verify: checks; unit tests of the provider's `authorize`; a browser check on a local
    or test database at desktop and 375 px.
  - Files: `src/lib/auth/config.ts`, `src/app/demo/page.tsx` (+ client form, action), `src/app/(app)/layout.tsx`, `src/components/demo-banner.tsx`, `src/app/page.tsx`, `src/app/(auth)/sign-in/page.tsx`

**Checkpoint 1:** a local template (hand-made) can be opened through `/demo`, copied,
browsed and expired.

### Phase 2: AI limit and real content (about 2 h 30 min, plus the template run)

- **E4: AI limit** (M)
  - Acceptance:
    - `callAi` counts calls for a copy only. The 31st call throws `AiLimitError`. Real
      users and the template are never counted.
    - Every pipeline entry point runs inside `withAiUser`. Calls made inside `mapLimit`
      and inside `after()` jobs are counted.
    - Each AI-starting action refuses with the spec's message once the limit is reached.
  - Verify: checks; tests with `AI_FIXTURES` (one counting test per pipeline kind, and a
    limit test); refusal tests for two representative actions.
  - Files: `src/lib/ai/budget.ts` (+ test), `src/lib/ai/client.ts`, the pipeline entry files, the AI-starting actions (pattern: one guard line each)

- **E5: Template script** (M)
  - Acceptance:
    - `planDemoHistory(questions, seed)` gives about 40/35/25% outcomes, 3–4
      misconceptions each used 2 or more times across courses, hints on about a third,
      and days spread over 21. It is deterministic.
    - `writeDemoWorking` has a schema, a LaTeX check and fixtures.
    - `putObject` uploads a buffer.
    - The script runs end to end with `AI_FIXTURES=1` against the in-memory database
      (one sheet), and is safe to run again.
  - Verify: checks; unit tests for the plan; a fixture run of the script.
  - Files: `scripts/build-demo.ts`, `src/lib/demo/history.ts` (+ test), `scripts/demo/write-demo-working.ts` (+ fixtures), `src/lib/storage/s3.ts`

**Checkpoint 2:** all checks pass; the fixture run builds a template that copies and
opens.

### Phase 3: Finish and release

- **E6: End-to-end test and build** (S)
  - Acceptance:
    - A new spec opens `/demo` with no sign-in and sees the banner and courses.
    - Start again gives a fresh copy. A second browser context gets a separate copy.
    - The pages fit 375 px.
    - The existing specs still pass.
  - Verify: `npm run e2e`; full checks; `npm run build`.
  - Files: `tests/e2e/demo.spec.ts`, plus a test-only template seed in `tests/e2e/helpers.ts`

- **E7: Release** (each step needs your go-ahead):
  1. apply migration E to Neon (it only adds columns);
  2. push `main`;
  3. run `scripts/build-demo.ts` against Neon and R2 with the real AI (about 250 calls,
     a one-off cost of a few dollars);
  4. open the live `/demo` and walk through it;
  5. review the content together.

  Rollback: revert the commits; the columns and the template can stay or be erased.

## Risks

| Risk | Mitigation |
|---|---|
| A table is missed when copying or erasing | One list of copied tables, a test that counts rows per table for the template and the copy, and an erase test that leaves no rows behind |
| AI calls in background jobs escape the count | `withAiUser` wraps the pipeline bodies, not the actions; tests run a pipeline inside `after()`-like async chains |
| Bots create copies | JavaScript-submitted sign-in, the 200-copy cap, and erasing on each visit |
| The real AI writes working that does not reach the target outcome | Accept what the marker gives; the planner's mix is a target, and the script prints the actual mix for review before release |
| The template script costs more than expected | It prints a call count as it goes; a `--course` flag limits a first run to one course |
| Analysis I files without `.pdf` | The script finds files by name and sets the MIME type from content |

## Verification (end to end)

- After each task: the checks, plus that task's own tests.
- At each checkpoint: `npm test -- --coverage`, with 100% on the rule folders including
  `src/lib/demo`.
- In E3: a browser check at desktop and 375 px.
- E6: `npm run e2e`, then `NEXT_DIST_DIR=.next-build npm run build`, reverting any
  `tsconfig.json` change the build makes.
- E7: on the live site, `/demo` opens straight into courses with the banner. The content
  matches success criterion 3. One submission works, and the limit message appears
  after 30 calls (checked by setting a copy's counter in the database).
