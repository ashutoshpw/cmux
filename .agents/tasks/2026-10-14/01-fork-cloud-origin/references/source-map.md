# Source changes and owners

Paths are relative to the repository root. This map identifies concrete owners inspected during planning. The accompanying domain inventory has the broad list of matched occurrences. Refresh both after the rebase; the current source is a mixed rebase snapshot.

## Native origins and shared auth

| Source | Required change |
| --- | --- |
| Packages/macOS/CmuxCloud/Sources/CmuxCloud/Environment/AuthEnvironment.swift | Replace every production pin for API, VM, push, device registry, broker, web/auth/billing and app-session handoff; replace hosted development defaults; consume approved fork config |
| Sources/Auth/MacAuthComposition.swift | Inject matching fork project, provider URL, API origin, callback and web-session trust inputs |
| Packages/Shared/CmuxAuthRuntime/Sources/CmuxAuthRuntime/Coordinator/AuthConfig.swift | Remove upstream project/key and API/magic-link callback defaults; resolve through fork-owned injected config |
| Packages/Shared/CMUXAuthCore/Sources/CMUXAuthCore/Models/CMUXAuthConfig.swift | Retain the existing injected per-environment auth configuration boundary |
| ios/cmuxPackage/Sources/cmuxFeature/MobileAuthComposition.swift | Replace productionSafeOverrides and productionCloudAPIBaseURL; remove cmux-staging.vercel.app fallback for loopback Cloud config |
| ios/Config/Release.xcconfig; ios/Config/Info.plist; ios/Config/Shared.xcconfig | Bake matching fork API/broker/presence/auth build values; preserve correct xcconfig URL encoding/substitution and inspect the built plist |
| ios/scripts/reload.sh; ios/scripts/cloud-testflight.sh; ios/scripts/upload-testflight.sh | Retarget production guards and baked defaults together |
| scripts/reload.sh; scripts/lib/verify-ios-release-origins.sh; scripts/run-iroh-release-gate.sh | Retarget --prod-auth origin checks and artifact checks; the current guards deliberately require upstream values |
| Packages/macOS/CmuxBrowser/Sources/CmuxBrowser/AppSession/BrowserAppWebOrigin.swift; Sources/Panels/BrowserAuthCallbackNavigationPolicy.swift | Audit origin and native callback trust using generated fork policy |
| Packages/macOS/CmuxCloud/Sources/CmuxCloud/VMClient/VMTunnelManager.swift | Decide fork interface naming; reconcile caches/enrollments if any fork state already exists |

AuthEnvironment has a legacy private default pointing at api.cmux.sh. Trace call sites and remove upstream destination choices even if a currently unused helper retains them. Keep generic user-directed browser/SSH URLs functional; the migration constrains managed service destinations.

## Web origins, trust, generated links and auth

| Source | Required change |
| --- | --- |
| web/app/env.ts | Validate canonical fork origins and existing specialized env values; add new production config validation at the actual runtime/build boundary |
| web/app/lib/request-origin.ts; web/proxy.ts | Separate approved production URLs from localhost/preview behavior; remove upstream alias destinations and check host routing |
| web/app/lib/native-callback.ts; web/app/handler/native-sign-in/route.ts; web/app/handler/after-sign-in/handler.ts | Register the exact fork callback scheme and preserve state/nonce/return-to checks |
| web/app/handler/app-session-handoff/route.ts; web/services/auth/stackBrowserSessionHandoff.ts | Trust only the new app origin and valid fork sessions |
| web/app/lib/stack.ts; web/app/lib/stack-client.ts; web/services/auth/stackProject.ts | Align production/development project IDs and browser/server SDK settings |
| web/services/auth/stackApiBaseURL.ts; web/services/auth/stackAccessToken.ts | Preserve provider API versus token issuer distinction; verify project/audience/JWKS alignment |
| web/services/teams/origin.ts; web/services/teams/inviteEmail.ts | Eliminate DEFAULT_TEAM_INVITE_ORIGIN upstream fallback; use canonical fork accept/download links |
| web/app/api/auth/email-verification/route.ts; web/app/api/billing/recover/route.ts; web/services/billing/purchase.ts | Replace production magic-link and verification callbacks and verify signed email flows |
| web/app/api/cli/config/route.ts | Remove the special canonical-auth rewrite to cmux.com for hosted CodeRouter |
| web/services/vms/routeHelpers.ts; web/app/api/billing/checkout/route.ts | Use fork checkout/pricing/team destinations in responses and typed errors |
| web/app/api/whats-new/route.ts; web/app/api/mobile-mac-compat/route.ts | Replace positive host allowlists; test exact-host rejection of upstream and lookalikes |
| web/app/[locale]/layout.tsx; web/app/[locale]/components/json-ld.tsx; web/app/sitemap.ts; web/app/robots.ts; web/i18n | Update metadataBase, canonical/hreflang/social URLs, schema.org URLs and discovery documents |
| web/next.config.ts | Replace managed development publication hosts and review image/CSP/connect rules |
| agent-chat/catalog.ts | Replace /api/agent-models default; audit explicit env overrides and failure behavior |

Review web/services/client-config and Packages/Shared/CmuxClientConfig consumers: validate server-supplied managed service URLs and invalidate cached upstream config so remote values cannot reintroduce old destinations.

Trace billing success/cancel/portal URLs, installed-app links, installers, account deletion/sign-out redirects, CLI auth return URLs, well-known/discovery documents and generated API descriptions. Preserve legitimate external provider URLs and user-chosen custom publication domains.

## Presence, connectivity and publications

| Source | Required change |
| --- | --- |
| Sources/Cloud/PresenceSettings.swift; Packages/iOS/CmuxMobileShell/Sources/CmuxMobileShell/PresenceServiceConfiguration.swift | Replace both production and debug upstream Worker defaults |
| ios/cmuxPackage/Sources/cmuxFeature/MobileIrohV2Configuration.swift; Packages/Shared/CmuxIrohTransport | Replace upstream workers.dev control-plane defaults wherever resolved; preserve environment/project scope checks |
| workers/presence/wrangler.toml; workers/presence/wrangler.dev.toml; workers/presence/src/controlPlaneDo.ts | Retarget Worker domains, CMUX_WEB_BASE_URL default, bindings and secrets to fork |
| workers/iroh-v2/wrangler.jsonc; workers/iroh-v2/src/environment.ts | Retarget Worker environments and DASHBOARD_ALLOWED_ORIGINS; retain exact origin checks |
| workers/iroh-v2/scripts/deploy-production.sh; workers/iroh-v2/scripts/rollout-policy.ts | Replace account/project/Worker URL and immutable-version assumptions with fork identity; establish first-deploy policy without disabling deployment guards |
| config/iroh/managed-relay-catalog.json; web/tools/generate-managed-iroh-relay-catalog.ts | Configure owned relay hosts, generate native/web/Worker consumers, and retain relay auth policy |
| services/iroh-relay-minter | Configure owned minting service, signing keys, audience and relay catalog; prevent upstream issuance |
| web/services/vm-publications/workflows.ts; web/app/api/vm/publications/routeShared.ts; web/app/api/freestyle/forward-auth/route.ts | Replace cmux.sh generated-domain default; configure fork auth origin/forward-auth callback and secret; verify wildcard domain in fork Freestyle account |
| web/services/vms/networkPolicy.ts; web/services/vms/images/network.ts | Replace required upstream artifact domains and permit precise fork control/artifact/model endpoints for restricted machines |

Changing Wrangler variables does not migrate upstream Durable Object namespaces. New fork Workers require their own namespaces and ownership database. Upgrades of existing fork Workers must preserve established namespaces and follow schema reader/writer compatibility.

## Artifacts, VMs, updates and CI

| Source | Required change |
| --- | --- |
| web/services/vms/images/manifest.json; web/scripts/build-devbox-freestyle.ts | Bake/verify snapshots in the fork Freestyle account and promote account-owned IDs for every supported size/kind |
| web/services/vms/guestCliDistribution.json; web/services/vms/guestCli.ts; web/services/vms/images/devbox | Publish/verify fork guest CLI artifacts and boot configuration; replace upstream service/install/help defaults |
| scripts/install-cmux-tui-client.sh; scripts/reload.sh; cmux-tui/crates/cmux-remote/src/ssh_bootstrap.rs | Replace manifest/payload defaults; use fork attestations and strict signer identity |
| cmux-tui/scripts/verify_published_manifest.py | Replace expected artifact host and source/signer repository; preserve digest and provenance verification |
| web/public/tui/install-static.sh; web/public/tui/install-static.ps1; CLI/CMUXCLI+VMTui.swift | Serve fork downloads and install telemetry; remove upstream installer instructions and shell defaults |
| Resources/Info.plist; scripts/build-sign-upload.sh; .github/workflows/release.yml | Replace upstream Sparkle feeds and release source so updates cannot reinstall upstream config; register fork signing keys |
| .github/workflows/cmux-tui-artifacts.yml; .github/workflows/cmux-tui-release*.yml | Publish fork R2 paths, metadata, attestations and release links |
| web/scripts/cloud-vm/projects.mjs; web/scripts/cloud-vm/smoke-vm-api.mjs; web/scripts/cloud-vm/dogfood-journey.mjs | Replace fixed Vercel project/org IDs, --scope manaflow and upstream smoke account domains |
| .github/workflows/cloud-vm-migrate.yml; .github/workflows/backend-migrations.yml; .github/workflows/presence.yml; .github/workflows/iroh-v2.yml | Bind fork environments/secrets/targets and preserve migration ordering and deployment receipts |
| .github/workflows/ci-web.yml; .github/workflows/vercel-auth-health.yml; scripts/run-e2e.sh; scripts/ci | Retarget active repo/deployment/cache defaults; replace private fleet dependencies with fork-supported runners and keep coverage |
| web/vercel.json | Retain required cron routes, configure paid scheduling capacity as needed, and enable appropriate fork preview workflow |
| coderouter/src/control_plane.rs; web/services/subrouter/hostedClient.ts | Retarget managed hosted defaults (including coderouter.dev, sr.cmux.com, subrouter.cmux.dev); verify primary-host route support and token origin validation |
| vault/internal/api/client.go; vault | Audit managed hosted server resolution using actual Go entrypoints; preserve explicit user server selection |

Do not rewrite all manaflow strings. Distinguish operational ownership/repo/permission rules from attribution, subsystem names, dependency source URLs and historical comments. Audit upstream analytics/Sentry/PostHog keys and alert/support sinks separately so fork events and messages stay in owned destinations.

## Product surfaces and generated data

Update Sources/App/CmuxHelpResource.swift, Sources/App/About/AboutPanelView.swift, CLI/CMUXCLI+DocsSettings.swift, pricing/legal/support screens, web install/download content, guest MOTD, README translations, schemas and web/messages. Use generated origin values or localized placeholders where URL values would otherwise be repeated in text.

Update raw GitHub links that fetch the fork's current settings schema, skills, downloads or release metadata to ashutoshpw/cmux. Keep historical upstream issue and attribution links accurate. Regenerate derived docs/search/relay artifacts from their source.

Run the cmux localization workflow for changed product copy and report the audit. Planning documents do not change product localization.
