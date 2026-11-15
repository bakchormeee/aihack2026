# Task List: Demo account for hackathon judges

Source spec: [SPEC-demo.md](../SPEC-demo.md) · Plan: [plan.md](plan.md)

Every task is built test first, then code, and gets one commit that names its files.
"Checks" means `npm run lint`, `npm run typecheck` and `npm test`. Sizes: S = 1–2 files,
M = 3–5 files.

## Phase 1: Copies

- [x] **E1: Migration E and demo rules** (S–M)
  - Acceptance: the `user` columns `demo_role`, `demo_expires_at` and `demo_ai_calls`
    exist, and existing users read as real; `timeShift`, `isExpired`, `copiesToErase` and
    `aiCallsLeft` cover every case, including exactly 24 hours and exactly 200 copies.
  - Verify: checks; the migration test; 100% coverage with `src/lib/demo` added.
  - Files: `src/db/schema.ts`, `src/db/migrations/0004_*.sql` (+ meta), `src/lib/demo/rules.ts` (+ test), `vitest.config.mts`

- [x] **E2: Copy and erase** (M)
  - Acceptance: `createDemoCopy` copies every row type with new ids and intact links,
    times end at now, file paths unchanged; two copies are independent and the template
    is untouched; `eraseDemoCopy` removes every row and deletes only `u/<copyId>/` keys;
    `eraseExpiredDemoCopies` erases expired copies and enforces the cap, never touching
    the template or a real user.
  - Verify: checks; integration tests on a hand-made template with a fake `deleteObject`.
  - Files: `src/db/queries/demo.ts` (+ test)

- [x] **E3: Demo sign-in, `/demo`, banner, buttons** (M)
  - Acceptance: the `demo` provider creates a copy (never the template); `/demo` reuses a
    live copy and starts the erase in `after()`; the banner with Start again shows for
    copies only; "Try the demo" on the landing and sign-in pages; `test` stays off in
    production.
  - Verify: checks; unit tests of `authorize`; browser check at desktop and 375 px.
  - Done 15 Nov on unit tests; the browser check moves to E6 (it needs migration 0004
    on a database, and the only one is Neon).
  - Files: `src/lib/auth/config.ts`, `src/app/demo/*`, `src/app/(app)/layout.tsx`, `src/components/demo-banner.tsx`, `src/app/page.tsx`, `src/app/(auth)/sign-in/page.tsx`

### Checkpoint 1
- [ ] A hand-made local template opens through `/demo`, is copied, browsed and expired.

## Phase 2: AI limit and real content

- [ ] **E4: AI limit** (M)
  - Acceptance: `callAi` counts calls for copies only and the 31st throws `AiLimitError`;
    every pipeline entry point runs inside `withAiUser`; AI-starting actions refuse with
    the spec's message once the limit is reached.
  - Verify: checks; counting and limit tests with `AI_FIXTURES`; refusal tests.
  - Files: `src/lib/ai/budget.ts` (+ test), `src/lib/ai/client.ts`, pipeline entry files, AI-starting actions

- [ ] **E5: Template script** (M)
  - Acceptance: `planDemoHistory` gives about 40/35/25% outcomes, 3–4 misconceptions
    each used 2+ times across courses, hints on about a third, days over 21, and is
    deterministic; `writeDemoWorking` has a schema, LaTeX check and fixtures; `putObject`
    uploads a buffer; the script runs with `AI_FIXTURES=1` and is safe to run again.
  - Verify: checks; unit tests; a fixture run of the script.
  - Files: `scripts/build-demo.ts`, `src/lib/demo/history.ts` (+ test), `scripts/demo/write-demo-working.ts` (+ fixtures), `src/lib/storage/s3.ts`

### Checkpoint 2
- [ ] All checks pass; the fixture run builds a template that copies and opens.

## Phase 3: Finish and release

- [ ] **E6: End-to-end test and build** (S)
  - Acceptance: `/demo` with no sign-in shows the banner and courses; Start again gives a
    fresh copy; a second browser context gets a separate copy; 375 px fits; existing
    specs pass.
  - Verify: `npm run e2e`; full checks; `npm run build`.
  - Files: `tests/e2e/demo.spec.ts`, `tests/e2e/helpers.ts`

- [ ] **E7: Release** (each step needs your go-ahead): migrate Neon; push `main`; run
  `scripts/build-demo.ts` against Neon and R2 (about 250 real AI calls); walk through the
  live `/demo`; review the content together.

## Carried over

- [ ] **Spot the error, live check** (you): run one spot-the-error session on the live site.
- [ ] **C1: Finish the live run-through** (you): a dispute, a revision session, and the hand-in export with a photo, on the live site.
- [ ] **C2: Demo preparation** (you): rotate the Anthropic key and delete the old one once the new one works. (The demo account itself is this plan.)
