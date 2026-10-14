# Status

- **State:** in-progress
- **Updated:** 2026-10-14

## Notes
- Plan reference links and curated source paths were checked locally. No application/runtime tests were run. The tracked inventory includes 597 matching files, supplemented by a targeted scan of provider/host defaults and large native catalogs.
- Full source-backed plan completed for the ashutoshpw/cmux fork and https://cmux.w3dev.app.
- Main plan links destination/config design, concrete source map, infrastructure prerequisites, phased delivery/verification, and tracked-source domain inventory.
- No operational fallback to cmux.com is permitted; related upstream hosted defaults, artifact services and updater paths are covered.
- Existing checkout is detached with unresolved rebase conflicts. Runtime implementation and Git state were not changed.
- Provider account/DNS/secret/live behavior verification remains future implementation work; this task is planning only.

- Implementation worktree: /home/ashutosh/.worktrees/ashutoshpw/cmux/fork-cloud-origin, based on the inspected cdbe99596fe snapshot. The original session-save rebase remains untouched. Migration delivery will use an explicit snapshot base branch until the fork main rebase is completed.

- Regression discovery: existing team-origin coverage admitted arbitrary production destinations and upstream defaults. Changed the existing owner-boundary cases; no test-only seam added.
- Red receipt: in web/, `bun run test -- ./tests/teams-origin.test.ts` executed 7 tests: 5 passed, 2 failed because the production default was cmux.com and invalid/upstream production configuration was accepted.
- Initial `verify-local.py` ran 16 portable checks successfully; Swift parsing was unsupported on this Linux host. Future runs will use the explicit inspected baseline to avoid comparing the entire upstream sync.
