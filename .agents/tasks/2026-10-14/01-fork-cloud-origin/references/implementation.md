# Implementation and remaining release gates

## Source decisions

- Shared contract: config/fork-deployment.json; regenerate with python3 scripts/generate-fork-deployment.py. Production is https://cmux.w3dev.app with no upstream fallback. Auxiliary domains are planned owned destinations, not verified deployments.
- Better Auth, OAuth Provider and Passkey packages are pinned to 1.7.7. Authentication uses a bounded built-in pg.Pool adapter; protected reviewed migrations own table creation and fixed native/web client registrations.
- OAuth issuer is the application origin plus /api/auth; API audience is the origin plus /api. Iroh project scope is the application origin. These identifiers have different roles.
- Cookie and OAuth resource authorization reread sessions, users and organization membership. Workers use the owned authority; Iroh signed tickets carry the originating session so revocation remains effective.
- Native apps use system-browser authorization code/PKCE and isolated Keychain storage. Mac bundle app.w3dev.cmux; iOS bundle app.w3dev.cmux.ios. Tagged callbacks and client IDs require separate exact registration.
- Legacy raw token handoff, Stack webhooks/mirror/session minting and password-injection operational tools are retired. The old Vault CLI device-login flow is unavailable until an owned OAuth device flow is added.
- Legacy Stack-dependent smoke, stress, benchmark, VM-scope and TestFlight backfill entrypoints are retired before credential/config access. Extracted provider probes remain available; rewrite operator journeys around owned OAuth sessions before hosted validation.
- API-key authentication is unavailable; the UI and creation boundary must not offer keys that cannot authenticate. Resource access uses cookie sessions and registered OAuth clients.
- The active image manifest is explicitly unprovisioned. Historical upstream bake records are archived, never selected for create. Use the existing bake/verify/promote workflow with owned provider credentials before enabling provisioning.
- Managed relay catalog is empty until owned relays exist. Mail recipients/senders, browser update signature key, Apple signing identities and artifact buckets require explicit owned configuration.
- Production Vercel publication uses the pinned W3Dev/vercel-deploy action and supplied literal team/project IDs. Automatic app Git deployment is disabled in source; the Vercel dashboard policy still needs verification.

## Native OAuth registrations

The protected migration seeds only these public clients:

| Client | Exact callback |
| --- | --- |
| cmux-w3dev-macos | cmux-w3dev://auth-callback |
| cmux-w3dev-ios | cmux-w3dev-ios://auth-callback |
| cmux-w3dev-web | https://cmux.w3dev.app/handler/oauth-callback (plus its exact staging counterpart) |

Register separate public clients for macOS nightly, RC and tagged builds before distributing them. Default channel clients are cmux-w3dev-macos-nightly, cmux-w3dev-macos-rc and cmux-w3dev-macos-dev[-tag], with matching cmux-w3dev-nightly, cmux-w3dev-rc and cmux-w3dev-dev[-tag] callback schemes. CMUX_OAUTH_CLIENT_ID can select an explicitly registered client in both Debug and Release builds. iOS tagged builds likewise need exact distinct registrations. Beta, Internal and Demo distribution clients are cmux-w3dev-ios-beta, cmux-w3dev-ios-internal and cmux-w3dev-ios-demo, with same-named callback schemes followed by ://auth-callback. The local seeding tool deliberately refuses remote databases and non-loopback authorization servers; production registrations belong in the protected configuration/migration workflow.

## Local evidence

- Origin regression commit be30ba2987c recorded 5 passed / 2 failed before repair. Origin and Vercel filter now pass all 9 tests.
- Deployment generator checks all 7 generated files; 4 behavioral Python tests pass.
- Settled source web replay: 5053 passed, 483 database-gated skips, zero failures across 498 files. The final replay completed on settled reviewed source with no injected Pro mail sender. The extra gated cases are the actual PostgreSQL transaction/admission regression suite; skipped cases are not executed evidence.
- Parent independently reran actual PostgreSQL/provider authentication: 25 tests / 191 assertions. Team transaction/admin/admission behavior: 15 tests / 41 assertions, including pool size one, five concurrent locks, live-admin removal/demotion, escaped scopes, real owned member revocations and all five invitation/admission entrypoints. Authority and concurrent credit ledger: 2 tests / 20 assertions. Each passed. The named disposable PostgreSQL container was removed after the final parent replays. MFA, cookie verification, organization leave and administrator deletion have retained red/green receipts.
- Full portable Workers: Presence 285 tests / 1402 assertions; Iroh 116 / 498. Both typechecks and Iroh contract/boundary checks pass. These are portable tests, not hosted Durable Object or network journeys.
- Rust CodeRouter control_plane: 14 executed tests passed; other Rust tests were filtered out.
- Native repair agent checks include 62 Python cases and 12 shared auth/artifact cases. Parent replay executes 64 selected Python cases, including signing/channel artifact and lean-checkout fixtures; shell/YAML/plist checks were also recorded. Native Swift compilation/tests cannot run on this Linux host.
- Repository portable preflight against cdbe99596fe13784ec5ea24d2e1c720a8f67f5cb passes all 16 checks, including wiring, config schema and native localization parity.
- Web typecheck and complexity gate pass. ESLint over 331 changed web files has zero errors and 41 unused-variable warnings; the final response-leaf delta has zero warnings. React Doctor improves from 76 to 78 with zero errors and three advisory warnings (bounded passkey deletion, sequential preparation and a utility export). Auth passkey/social/MFA exceptions now release loading state and show existing localized errors.
- Next source build passes with SKIP_ENV_VALIDATION=1 after the final admission guard exposed an eager team-error/VM/billing import cycle. The existing JSON response implementation was moved byte for byte into a dependency-free shared leaf; routeHelpers retains its compatible export. The build demonstrated red before extraction and green after it. A normal production build still requires real owned secrets/configuration; this bypass proves source compilation and route generation only.
- Independent reviews explicitly request gpt-6.1-sol at xhigh; actual runtime model metadata is unobservable. Initial reviews found twelve defects; second reviews found eight. Repairs cover shared MFA challenges, current user/session/member validation, team-lock transaction reuse, live administrator eligibility, signing/channel/config resolution and generation-scoped OAuth ownership. Native repair review of immutable tree 7fb8e01c05ff2bd879d6b4319c43d9fdc10b74e2 returned ship. The next server review found one invitation/deletion race, reproduced through all five admission paths. One shared live-administrator guard now owns admission under the team lock. Final independent admission/UI/response-leaf review returned ship at tree 7567025e6f047ec1b04d17877bb8f89735fed6e4 and verified the native runtime remained unchanged apart from a trailing blank line. All four review receipts conform to the repository schema. Review receipts stay outside source control under Git metadata.
- New auth mail covers all 20 web languages. Native localization has no parity errors. The separate global web catalog helper still reports pre-existing parity gaps; it is not a passing localization receipt.

## Deployment gates

1. Preserve the original checkout's session-save rebase. The inspected source baseline differs substantially from fork main; review source against a snapshot branch and integrate deliberately without force updating main.
2. Configure the supplied Vercel project with root web, source outside root available, correct build command, primary domain, production environment and VERCEL_TOKEN in GitHub's vercel-production environment.
3. Provision owned PostgreSQL and mail, apply the migration through the protected migration command, and register exact callbacks for any tagged/native channel clients.
4. Provision owned Workers/routes/secrets, relays, artifact hosts and signatures; bake and promote fork VM images. Declare matching CLOUDFLARE_ACCOUNT_ID and CMUX_FORK_CLOUDFLARE_ACCOUNT_ID; use the separate audited first deployment procedure in workers/iroh-v2/README.md before guarded upgrades. No upstream rollback version or account is accepted.
5. Build signed fork apps with owned Apple registrations, entitlements, APNs and updater keys. Supply CMUX_APPLE_TEAM_ID and, for Fastlane, CMUX_APP_STORE_CONNECT_TEAM_ID plus the owned App Store app record. Run native compilation and authenticated device journeys before release.
6. Verify actual deployment SHA/team/project/domain, authenticated web/native/Worker revocation, and VM lifecycle with owned infrastructure. Source tests do not prove those hosted behaviors.

No hosted deployment, production migration, account provisioning, DNS change or native app launch is established by this implementation.
