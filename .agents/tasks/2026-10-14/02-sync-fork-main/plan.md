# Synchronize fork main and correct the migration PR target

**Date:** 2026-10-14
**Task:** 02-sync-fork-main

## Objective
Synchronize ashutoshpw/cmux:main with fetched upstream main while preserving the fork session-save feature, then target migration PR #1 at fork main.

## Context
User explicitly requires upstream synchronization before fixing PR #1's target. Fork main is 0576b679af4581305854168352c4a814babb0428, with one unique session-save commit and 18892 upstream commits missing. Fetched upstream is 321d7d4458abb4005584f8459cf98ade967b38ad. Original checkout rebase was backed up and aborted; checkout now tracks origin/main.

## Approach
Use named sync-fork-main tracking worktree, merge upstream without force updates, reconcile the existing feature against current source owners, review and verify the preservation delta. Keep the Better Auth/origin migration separate. Retarget PR #1 after main synchronization and reconcile its head with the updated base.

## Steps
- [x] Fetch exact fork/upstream coordinates and inventory unique fork commits.
- [x] Create isolated tracking worktree and start no-commit upstream merge.
- [x] Resolve eight native conflicts, preserving session save/open and translations.
- [x] Run scoped portable verification and independent gpt-6.1-sol review.
- [ ] Publish the reviewed synchronization according to repository merge authorization rules.
- [ ] Retarget PR #1 to main and reconcile the migration with the synchronized base.
- [ ] Record final source/remote parity and remaining native verification limits.

## Acceptance criteria
- [ ] Fetched upstream commit and original fork commit are ancestors of resulting main.
- [ ] Session save/open entrypoints and persisted commands survive reconciliation.
- [ ] Original checkout and unfinished rebase are preserved.
- [ ] PR #1 has base ashutoshpw/cmux:main with accurate integration/verification notes.
