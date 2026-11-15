# Task List: Deleting courses and sheets; working for several questions at once

Source specs: [SPEC-delete.md](../SPEC-delete.md), [SPEC-batch-working.md](../SPEC-batch-working.md) · Plan: [plan.md](plan.md)

Every task is built test first and gets one commit. "Checks" means `npm run lint`,
`npm run typecheck` and `npm test`. Acceptance, verification and files for each task
are in [plan.md](plan.md).

## Phase 1: Foundations (coordinator)

- [ ] **D1: Migration F and bin rules** (M)
- [ ] **B1: Region rules and the `batch` upload purpose** (M)

### Checkpoint 1
- [ ] All checks pass; both tracks can start

## Phase 2: Delete (after D1)

- [ ] **D2: Bin and restore, and 404 for binned items** (M)
- [ ] **D3: Binned work is hidden and does not count** (M, after D2)
- [ ] **D4: Delete dialogs and Recently deleted** (M, after D2)
- [ ] **D5: Erase after 30 days** (M, after D4)

### Checkpoint 2
- [ ] Delete, restore and erase work in the browser on a test account

## Phase 3: Batch working (after B1; can run beside Phase 2)

- [ ] **B2: `matchWorking` and the propose action** (M)
- [ ] **B3: Submit the confirmed regions** (M, after B2)
- [ ] **B4: The review screen** (M, after B3)

### Checkpoint 3
- [ ] Two photos for four questions are matched, corrected, submitted and marked

## Phase 4: Finish and release

- [ ] **D6: End-to-end test of delete** (S, after D5)
- [ ] **B5: End-to-end test of batch working** (S, after B4)
- [ ] **R1: Release** (each step needs your go-ahead): apply migration F to Neon; full
  checks, `npm run e2e` and the build; push `main`; check both features live.

## Carried over

- [ ] **Spot the error, live check** (you): run one spot-the-error session on the live site.
- [ ] **C1: Finish the live run-through** (you): a dispute, a revision session, and the hand-in export with a photo, on the live site.
- [ ] **C2: Rotate the Anthropic key** (you): and delete the old one once the new one works.
