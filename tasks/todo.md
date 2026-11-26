# Task List: Study views

Source spec: [SPEC-study-views.md](../SPEC-study-views.md) · Plan: [plan.md](plan.md)

Every task is built test first and gets one commit. "Checks" means `npm run lint`,
`npm run typecheck` and `npm test`. Acceptance, verification and files for each task are in
[plan.md](plan.md).

## Phase 1: Foundations (coordinator)

- [x] **F1: Migration 0006, coverage list, Tooltip and Switch** (M)

### Checkpoint 1
- [x] Checks pass; the tracks can start

## Phase 2: Course screens

- [x] **T1: Sheets is the default course tab** (M)
- [x] **T2: Topics list with word labels** (M, after T1)
- [x] **T3: Progress bands; skill map and Focus next deleted** (M, after T2)

### Checkpoint 2
- [ ] Course opens on Sheets; Topics tab and Progress chart work in the browser

## Phase 3: Marks on the sheet

- [x] **T4: Status of each question on the Questions tab** (M)
- [x] **T5: Attempted-only sheet score** (M, after T4)
- [x] **T6: Summary from the first mark** (M, after T5)

### Checkpoint 3
- [ ] A partly marked sheet shows row statuses, the score line and a Summary naming its questions

## Phase 4: The mark on the question page

- [x] **T7: The evaluation on the question page** (L, after T4)
- [x] **T8: Attempt timeline** (M, after T7)
- [x] **T9: Working by type; official solutions win** (M, after T8)

### Checkpoint 4
- [ ] Three attempts (typed, photo, PDF): newest shown, oldest selectable, official solution and mark after an upload

## Phase 5: AI marking switch and PDFs in batch

- [x] **T10: Every submit follows the marking plan** (M, after F1)
- [x] **T11: Official upload marks waiting work; Mark with AI instead** (M, after T10)
- [x] **T13: PDF pages to JPEGs** (M, ask first: `pdfjs-dist`)
- [x] **T14: Batch upload accepts one PDF** (M, after T13)
- [x] **T12: The switch on every submit button** (M, after T4, T7, T11 and T14)

### Checkpoint 5
- [ ] Switch off → waiting → official upload marks it; a 3-page PDF goes through batch upload

## Phase 6: Finish and release

- [x] **E1: End-to-end tests for the new screens** (M)
- [ ] **R1: Release** (each step needs your go-ahead): migration 0006 to Neon; full checks,
  `npm run e2e` and the build; push `main`; check live; spec Status → implemented.

## Carried over

- [ ] **Spot the error, live check** (you): run one spot-the-error session on the live site.
- [ ] **C1: Finish the live run-through** (you): a dispute, a revision session, and the hand-in export with a photo, on the live site.
- [ ] **C2: Rotate the Anthropic key** (you): and delete the old one once the new one works.
