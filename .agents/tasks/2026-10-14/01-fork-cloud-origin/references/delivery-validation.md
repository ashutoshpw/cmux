# Delivery phases and verification

## P0 — Establish a clean implementation baseline

Finish the current rebase using its existing task, then refresh this source inventory and confirm origin still points to ashutoshpw/cmux. Preserve all existing changes.

Create the implementation branch in ~/.worktrees/ashutoshpw/cmux/fork-cloud-origin. If the branch already exists remotely, use git worktree add <path> --track -b <local-branch> origin/<remote-branch>; never detach the worktree. For a brand-new branch, create it from refreshed origin/main with a named local branch. Use fork PRs and origin/main as the delivery target.

Record provisioned service ownership, target hostnames, auth project IDs and app identities. Search open upstream PRs by origin/auth/config symptom before implementation, as repository instructions require; reuse/credit outside work according to those instructions. Keep fork-specific changes independently reviewable for future upstream rebases.

## P1 — Trusted config and regression proof

Add the nonsecret deployment manifest and adapters/generation to existing config owners. Add behavioral regressions for production pins and generated output, with no upstream recovery path. Commit the failing regression before the implementation and record the same focused command's red and green result. A configuration/setup failure is not a behavioral red result.

Meaningful assertions include the actual resolved URL, intercepted outgoing URL, generated redirect/email URL and built plist/manifest contents. Use positive cases for the new host and negative cases for cmux.com, www.cmux.com, subdomains, HTTP, userinfo, lookalike suffixes and redirect hops.

Keep one shared action/config boundary for all entrypoints. A static source inventory guard is useful drift detection, but cannot substitute for behavior or authenticated production evidence.

## P2 — Web/auth control plane

Centralize canonical URL generation and replace upstream defaults. Update exact host and callback allowlists, account/session handoffs, email and billing links, CLI auth confirmation, web metadata and routing. Keep token issuer/JWKS/project checks intact.

Retarget Stack/Hexclave production and development projects and verify SDK/REST/issuer behavior. Register provider origins, OAuth redirect URIs and selected email callbacks. Preserve callback state, nonce, expiry and safe-return URL enforcement.

Exit evidence: focused auth/origin/CSRF tests pass, web typecheck/lint/build pass with fork public config, and a protected staging login works. No canonical redirect or generated link returns upstream.

## P3 — Native clients and entrypoints

Replace macOS, shared auth and iOS config together, including production-auth tagged builds, Cloud staging fallback, browser handoff trust, billing/help links, presence configuration and release script guards. Retarget CLI docs/installer links and the agent-chat model catalog.

Scope retained session data by project/origin and prove a switch cannot reuse upstream tokens. Validate selected team, account deletion/sign-out and device/tunnel cleanup through the real entrypoints. If fork bundle IDs/callback schemes are adopted, update native registration and server allowlists in the same delivery unit.

Exit evidence: relevant Swift tests execute, native app and test targets compile, built plists contain fork values, and tagged Mac plus matching tagged iOS builds sign in with the intended fork account.

## P4 — Connectivity, VM publications and guest access

Deploy fork presence/Iroh Workers and provision relay/minter services with correct project/environment scope. Retarget exact dashboard origins and control-plane proxy default. Establish first-deploy namespace/config receipts; preserve namespace and SQLite compatibility on later upgrades.

Verify managed publication wildcard DNS/certificates in the fork Freestyle account; set auth origin and forward-auth secrets. Replace required guest artifact domains and ensure allowlist/denylist modes allow needed fork endpoints without broad wildcard exemptions.

Exit evidence: same-account Mac/iOS discovery, pairing, relay-assisted reconnect and revocation work; cross-account and cross-project access fail; publications enforce private/public permissions.

## P5 — Artifacts, images and delivery ownership

Publish fork cmux-tui/relay/CLI artifacts with digest and GitHub provenance attestations. Retarget payload/manifest/installer defaults, expected source repository and signer workflow. Configure fork caches, release URLs and updater feeds.

Bake, verify and promote the complete supported Freestyle snapshot ladder under the fork account. Update guestCliDistribution and current-image manifest only from successful fork builds. Running machines do not update themselves: apply the documented Cloud guest upgrade contract if any existing fork machines must receive new binaries or origins.

Retarget Vercel target project/org/scope, Cloudflare deploy identity checks, smoke scripts, migration jobs, GitHub repository defaults and active workflow caches. Reconfigure analytics/support sinks and signing identities.

Exit evidence: a newly created restricted-network VM boots, obtains fork artifacts, installs the CLI, attaches and executes; manifest signer/digest validation works; a fork updater cannot fetch or install an upstream release.

## P6 — Product copy, localization and reviewable delivery

Update active website/docs/help/install/support/legal links and translations. Run ./scripts/localize-changes and resolve its translation packet, then python3 scripts/localization_catalog.py check. Confirm matching web locale keys and placeholders. Preserve license/attribution and historical references.

Run scoped validation on the clean trusted implementation worktree and open PRs in ashutoshpw/cmux. Suggested delivery units are trusted config/web/native, connectivity/VM images, and artifacts/distribution/product links, with explicit dependencies; partial units must not be published as a complete migration.

The repository requires a review subagent before merge. Use cmux-review at that point. App/runtime/UI merging still requires the user's explicit merge directive or post-dogfood approval. A plan request does not authorize deployment, publication or merge.

## Verification matrix

Run these commands only after implementation and fork-target configuration. This planning task does not execute application tests or provider operations.

| Scope | Commands/evidence |
| --- | --- |
| Repo preflight | python3 scripts/verify-local.py from the clean trusted worktree; select checks for changed files |
| Native package behavior | Focused suites in CMUXAuthCore, CmuxAuthRuntime, CmuxCloud, browser and Iroh owners as touched; compile and execute, recording nonzero counts |
| App behavior | cmuxTests/AuthEnvironmentTests.swift and affected callback/Cloud entrypoints; compile the app test target through scripts/test-unit.sh before a scoped E2E lane |
| iOS | MobileAuthEnvironmentOverrideTests and affected MobileIrohV2Configuration/presence suites; inspect built release plist and run scripts/lib/verify-ios-release-origins.sh against actual artifact |
| Web focused cases | In web/: bun run test -- ./tests/teams-origin.test.ts ./tests/app-session-handoff-route.test.ts ./tests/vm-route-auth.test.ts ./tests/vm-network-policy.test.ts ./tests/vm-publication-auth.test.ts; add relevant new regression selectors |
| Web static/build | In web/: bun run typecheck; bun run lint; bun run lint:complexity; bun run build |
| DB behavior | In web/: bun run db:test, with isolated local PostgreSQL; then fork-target migration preflight and explicit staging/production receipts |
| Presence Worker | In workers/presence/: bun run check; then fork deploy + authenticated service journeys |
| Iroh Worker | In workers/iroh-v2/: bun run check; bun run test:runtime; fork-target drift/provenance verification |
| Installer/relay/CLI | Relevant cmux-tui manifest verifier, SSH bootstrap and CodeRouter Rust tests; mock/intercept network requests and validate artifact signer/digest |
| Generated config/catalogs | Deterministic generated-config --check plus web/tools/generate-managed-iroh-relay-catalog.ts --check |
| Localization | ./scripts/localize-changes; python3 scripts/localization_catalog.py check; changed web locale key/placeholder checks |
| End-to-end VM flow | Fork-retargeted web/scripts/cloud-vm/smoke-vm-api.mjs and dogfood-journey.mjs; preserve target safeguards and record created resource cleanup |
| Mobile soak | Follow docs/ios-connectivity-soak.md on same-tag isolated Mac/iOS builds; physical-device auth gate and persisted reconnect receipt |
| Final network evidence | Captured first-party outbound requests, redirects, WebSocket connections and artifact downloads for each enabled journey; no upstream service destinations |

Commands that previously use --scope manaflow or upstream project IDs must be retargeted before execution. Raw HTTP 200 from a login page or health route is not authenticated API/VM evidence.

Static scanning must cover cmux.com, its subdomains, upstream cmux.dev/cmux.sh service hosts, cmux-staging.vercel.app, debussy.workers.dev defaults, coderouter.dev, active upstream GitHub artifact/updater references and escaped hostname patterns. Classify legitimate provider/dependency/history/license/negative-test references individually. Scan generated build outputs and public artifacts as well as source; generic browser URLs supplied by users are not managed-origin violations.

## P7 — Staging rehearsal and coordinated production release

1. Provision fork staging auth, databases, Workers and service secrets. Complete DNS/TLS for staging and proposed auxiliary hosts.
2. Publish verified fork artifacts, bake account-owned snapshots and apply staged database migrations. Configure webhook targets, crons, alert sinks and rate limits.
3. Deploy the web and Workers from a pinned candidate revision. Record project/account/namespace/source identities and protocol compatibility.
4. Verify browser signup/sign-in/OAuth/magic-link/verification/recovery, native sign-in/handoff, team invite/accept, sign-out/revocation and account deletion.
5. Verify denied and authorized API calls, team/VM isolation, create/list/exec/attach/network/pause/resume/snapshot/restore/delete, CLI/model catalog and guest downloads.
6. Verify private/public VM publications, protected forwarding, wildcard certificate routing, mobile presence/pairing/push and relay-assisted reconnect.
7. Verify billing/entitlements if enabled, including failure paths and replay-safe webhook deliveries. Verify updater/install provenance and all current metadata/help links.
8. Block upstream service domains in the test client's environment and simulate target outage, missing config and upstream redirects. Operations must fail explicitly; observe that no managed request retries against upstream. Limit test interception/blocking to the isolated build/process and test environment.
9. Promote the same validated revisions/config/artifacts to fork production. Apply production migrations through the protected job before compatible code depends on them. Register production webhook/cron targets and verify their deliveries.
10. Verify production with controlled fork accounts and test resources, then publish signed fork Mac/iOS/CLI distributions pointing at the new host. Save receipts with the exact commit/config digest, deployment version, image IDs, test counts and any unverified gates.

No DNS change, redirect or webhook modification on upstream cmux.com is part of the rollout. Existing upstream clients are not a migration channel for the fork.

## P8 — Failure recovery and completion

Rollback application/Worker code only to a known fork-origin-compatible revision, keeping the new domain and owned backing services. Respect DO/SQL reader/writer compatibility and signing/feed provenance. If no compatible revision exists, disable affected functionality or serve maintenance until a forward fix; never route back to cmux.com.

Record database backups and reconciliation procedures before production state changes. Do not restore stale auth grants or provider state blindly from a snapshot. Retain fork-owned image/artifact versions needed by running machines.

Completion requires the main plan acceptance checklist, verified enabled-feature journeys, network evidence, operational target receipts and a classified residual reference report. Source publication, compilation, local tests and health checks each prove only their own scope.

## Planning-only verification

The plan and its repository links can be checked locally without an app build. Inventory values describe the current source snapshot, not deployed settings. No runtime tests, credentials, account changes, domain changes, deployments or upstream API calls are required to deliver this plan.
