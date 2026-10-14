# Replace the fork's production origin

**Date:** 2026-10-14
**Task:** 01-fork-cloud-origin
**Repository:** github.com/ashutoshpw/cmux
**Target:** https://cmux.w3dev.app

## Objective
Make the target the sole production website, authenticated API, Cloud VM control plane, and native sign-in origin. Remove operational use of upstream cmux domains, including hidden defaults, artifact downloads, staging destinations, and updater paths. No fallback or recovery path may send traffic or credentials to cmux.com.

## Context
The source includes the web control plane, macOS/iOS clients, CLI, VM guest tooling, and Workers. Production URLs and upstream project/account identities are repeated across these areas. This is a fork deployment: no access to or change on upstream infrastructure is assumed.

The planning snapshot is HEAD cdbe99596fe13784ec5ea24d2e1c720a8f67f5cb plus unresolved rebase changes. Resolve the existing rebase before implementation; refresh the inventory afterward. This task changes planning documents only.

## Approach
Use a validated, nonsecret deployment manifest with generated inputs for existing config owners. Keep production credential destinations pinned to the fork's trusted origins. Use fork-owned auth projects, provider accounts, databases, artifacts, signing, and deployment targets. Start with fresh fork state unless an explicit data migration is separately authorized.

## Implementation sequence
- [x] Inspect source, confirm fork remote, and preserve the conflicted checkout.
- [x] Inventory origin consumers, upstream service dependencies, and deployment guards.
- [x] Define the destination contract, prerequisites, and verification gates.
- [ ] P0: Finish the rebase; record fork service identities; create a migration worktree.
- [ ] P1: Add the deployment manifest, validated config adapters, and behavioral regressions.
- [ ] P2: Replace web/API/auth URL generation, trust rules, callbacks, emails, and metadata.
- [ ] P3: Replace macOS/iOS production defaults, shared auth defaults, CLI and model-catalog routes.
- [ ] P4: Retarget presence, Iroh, relay policy, VM publications, and guest networking.
- [ ] P5: Publish fork artifacts and images; retarget installers, updater feeds, CI, and deployment guards.
- [ ] P6: Update product links and translations; complete scoped validation and open fork PRs.
- [ ] P7: Deploy to fork staging, verify authenticated journeys, promote the same revision, and release fork clients.
- [ ] P8: Record production receipts and prove upstream outage cannot activate an old destination.

## Acceptance criteria
- [ ] Production resolves only the approved fork destinations, even with stale upstream launch/config values.
- [ ] Auth callbacks, token issuer validation, team ownership, CSRF, and handoff nonce protections work together.
- [ ] VM create/list/exec/attach/network/pause/resume/snapshot/delete and guest boot work on fork infrastructure.
- [ ] Enabled mobile, presence, relay, publication, billing, and model-routing flows use fork-owned configuration.
- [ ] Downloads, updates, generated links, metadata, help, and localized product copy use fork destinations.
- [ ] Missing service configuration or failed requests produce explicit errors without upstream retries.
- [ ] Network, build, test, image, and deployment receipts distinguish local checks from hosted behavior.
- [ ] Rollback remains within fork-compatible revisions and fork infrastructure.

## References
- [references/design.md](references/design.md) — destination map, configuration, auth trust, and state policy.
- [references/source-map.md](references/source-map.md) — concrete source owners and required changes.
- [references/infrastructure.md](references/infrastructure.md) — external accounts, environment settings, and risks.
- [references/delivery-validation.md](references/delivery-validation.md) — phased delivery, checks, live journeys, and rollback.
- [references/domain-inventory.md](references/domain-inventory.md) — tracked-source domain occurrences with file and line numbers.
