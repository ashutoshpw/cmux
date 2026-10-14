# Replace the fork's production origin

**Date:** 2026-10-14
**Task:** 01-fork-cloud-origin
**Repository:** github.com/ashutoshpw/cmux
**Target:** https://cmux.w3dev.app
**Vercel:** team_bhbVYR6BqVYMXKwAp7F1k5ib / prj_3z4VuRVvSvlm5LYNnEuqHa4FKKtn

## Objective
Make the target the sole production website, authenticated API, Cloud VM control plane, and native sign-in origin. Remove operational use of upstream cmux domains, including hidden defaults, artifact downloads, staging destinations, and updater paths. No fallback or recovery path may send traffic or credentials to cmux.com.

## Context
The source includes the web control plane, macOS/iOS clients, CLI, VM guest tooling, and Workers. Production URLs and upstream project/account identities are repeated across these areas. This is a fork deployment: no access to or change on upstream infrastructure is assumed.

The planning snapshot is HEAD cdbe99596fe13784ec5ea24d2e1c720a8f67f5cb plus unresolved rebase changes. The unresolved rebase is preserved. Implementation uses an isolated worktree from the inspected snapshot; delivery requires a snapshot base without rewriting main.

## Approach
Use a validated, nonsecret deployment manifest with generated inputs for existing config owners. Keep production credential destinations pinned to the fork's trusted origins. Use Better Auth Organization and OAuth Provider with PKCE, fork-owned provider accounts, databases, artifacts, signing, and deployment targets. Start with fresh fork state unless an explicit data migration is separately authorized.

## Implementation sequence
- [x] Adopt Better Auth Organization and OAuth Provider/PKCE with distinct fork identities.
- [x] Inspect source, confirm fork remote, and preserve the conflicted checkout.
- [x] Inventory origin consumers, upstream service dependencies, and deployment guards.
- [x] Define the destination contract, prerequisites, and verification gates.
- [x] P0: Preserve the rebase, record source identities, and create an isolated migration worktree.
- [x] P1: Add the deployment manifest, validated config adapters, and behavioral regressions.
- [x] P2: Replace web/API/auth URL generation, trust rules, callbacks, emails, and metadata.
- [x] P3: Replace macOS/iOS production defaults, shared auth defaults, CLI and model-catalog routes.
- [x] P4: Retarget presence, Iroh, relay policy, VM publications, and guest networking.
- [x] P5 source: Retarget installers, updater feeds, CI and deployment guards; leave images and relays explicitly unprovisioned.
- [ ] P5 publication: Build, verify and publish fork-owned artifacts, images and relays using actual provider/signing configuration.
- [x] Add .github/workflows/deploy-vercel.yml using W3Dev/vercel-deploy with the exact hardcoded Vercel team/project IDs; validate builds and prevent duplicate deployment triggers.
- [x] P6 source: Update product destinations and translations; run local verification.
- [x] P6 delivery: Finish independent repair reviews and publish draft fork PR [#1](https://github.com/ashutoshpw/cmux/pull/1) against the snapshot baseline.
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
- [ ] GitHub deployment uses the required action, exact literal target IDs, and VERCEL_TOKEN secret; deployment evidence identifies the correct fork revision/project/domain.

## References
- [references/design.md](references/design.md) — destination map, configuration, auth trust, and state policy.
- [references/source-map.md](references/source-map.md) — concrete source owners and required changes.
- [references/infrastructure.md](references/infrastructure.md) — external accounts, environment settings, and risks.
- [references/delivery-validation.md](references/delivery-validation.md) — phased delivery, checks, live journeys, and rollback.
- [references/domain-inventory.md](references/domain-inventory.md) — tracked-source domain occurrences with file and line numbers.
- [references/auth-decision.md](references/auth-decision.md) — Better Auth decision, prerequisites, and confirmed fork identity choice.
- [references/vercel-workflow.md](references/vercel-workflow.md) — confirmed hardcoded target IDs and GitHub Actions deployment specification.
- [references/implementation.md](references/implementation.md) — current source contracts, local evidence and unresolved release gates.
