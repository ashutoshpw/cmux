# Fork infrastructure and owner inputs

This is a source-backed plan. DNS, provider accounts, secrets, existing fork customer data and live service availability were not inspected. Proposed auxiliary hostnames must be provisioned before they are baked into a release.

## Required ownership and provisioning

| Component | Required input/action | Completion evidence |
| --- | --- | --- |
| DNS and TLS | Control w3dev.app; add primary/staging/artifact/Worker/publication hosts; verify nested wildcard certificate requirements | Provider domain status and HTTPS certificate checks for every enabled host |
| Vercel | Create owned project(s) linked to ashutoshpw/cmux with web/ root directory; register domains; set production/preview branch policy and required limits/crons | Fork project/team IDs, Git linkage and exact deployment SHA/domain receipts |
| Auth | Create owned production and development/staging Stack/Hexclave projects; configure public/server keys, OAuth providers, approved origins/callback URLs and sender domains | Web, macOS and iOS resolve the same project for a given environment; verified login and issuer/JWKS receipts |
| PostgreSQL | Provision owned production and staging databases, preferably retaining current PlanetScale PostgreSQL architecture; set CMUX_DB_DRIVER=url | Correct database identity and protected migration receipts; no upstream cmux organization/db default in active tools |
| Freestyle | Owned API credential or supported Stack-token/team credential; private networks, verified publication zone and new snapshots | Snapshot IDs work under this credential; create/attach/exec and ownership checks succeed |
| Cloudflare Workers | Owned account/API token, presence and Iroh Workers, Durable Object namespaces and ownership DB binding | Account/project/source/namespace metadata and protocol health on fork endpoints |
| Iroh relays/minter | Owned relay hosts, TLS, signing configuration, production relay policy and minting service | Direct and relay-assisted mobile/Mac paths work; unowned clients cannot obtain access |
| Artifacts | Owned R2 buckets/public endpoint; fork build workflow and attestations; release manifests | Downloaded artifact digest/signature/provenance identify ashutoshpw/cmux |
| macOS distribution | Apple Developer identity, fork bundle IDs/entitlements, notarization and Sparkle signing key | Built app identity and feed point only to fork; signed update installs fork build |
| iOS distribution | Owned Apple app/bundle/groups/APNs keys; separate App Store/TestFlight IDs if publishing | Physical-device push/pairing/auth and matching transaction verification config |
| Billing | Owned Stripe products/prices, webhook secrets, return URLs; recreate auth payment items/entitlements | Paid/free/denied flows and replay-safe webhook processing on fork |
| Email | Owned Resend/sender domain and verified support address | Invite, magic-link, verification and recovery messages contain fork links and reach controlled inboxes |
| Model services | Owned CodeRouter/hosted Subrouter/KMS/usage storage settings as required by enabled flows | CLI and guest model requests use owned control plane and valid scoped credentials |
| Observability | Owned Sentry/PostHog/Axiom/OTel/ClickHouse/alert sinks or explicit supported disable policy | Fork events reach owned sinks; no upstream ingestion key/default is active |
| GitHub delivery | Fork environments, Actions secrets/variables, supported macOS/Linux runners and attestations | Focused CI runs against fork SHA; deploy/release tooling refuses upstream target identities |

The repository LICENSE states that web/, the listed server Workers, and related server components require a commercial license for production use including self-hosting. Record the applicable production grant before operating those components; preserve license and copyright notices. This is an existing repository constraint, not a request to change license terms.

## Environment contract

Resolve all values for production and staging separately; fill actual identities before implementation delivery. Secret values belong in provider/GitHub secret stores, never the plan or generated manifest.

| Setting | Expected production behavior |
| --- | --- |
| CMUX_APP_ORIGIN | https://cmux.w3dev.app, validated through new canonical config |
| CMUX_TEAM_INVITE_ORIGIN | Same approved origin or derive it centrally |
| CMUX_VM_ALLOWED_ORIGINS | Exact approved browser mutation origins; preserve CSRF checks |
| CMUX_VM_PUBLICATION_AUTH_ORIGIN | https://cmux.w3dev.app |
| CMUX_VM_PUBLICATION_GENERATED_DOMAIN | Proposed vm.cmux.w3dev.app, provider verified |
| CMUX_VM_PUBLICATION_FORWARD_AUTH_SECRET | New fork secret; same verification contract on publication and app routes |
| CMUX_CODEROUTER_PUBLIC_ORIGIN | Approved fork origin, with actual /v1 route behavior verified |
| CMUX_PRESENCE_BASE_URL | Fork presence Worker origin |
| CMUX_WEB_BASE_URL (presence Worker) | https://cmux.w3dev.app; same trusted default in Worker code |
| DASHBOARD_ALLOWED_ORIGINS (Iroh Worker) | Exact new origin; no upstream origin entries |
| CMUX_IROH_MINT_URL | Explicit owned minting service |
| NEXT_PUBLIC_STACK_PROJECT_ID / NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY | Owned production public config; match generated native config |
| STACK_SECRET_SERVER_KEY / STACK_WEBHOOK_SECRET | Matching owned project server/webhook secrets |
| Stack/Hexclave API URL variables | Consistent SDK/REST provider host; issuer/JWKS treated separately and verified |
| DATABASE_URL / CMUX_DB_DRIVER | Owned production PostgreSQL / url |
| FREESTYLE_API_KEY or supported alternative credential group | Owned provider account that owns promoted snapshots |
| CRON_SECRET | New fork cron secret, required before scheduling |
| STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET and price IDs | Owned billing account/products; no upstream defaults |
| CMUX_APNS_* / APPLE_IAP_* | Match owned bundle/app/team identities |
| Vercel/GitHub/Cloudflare/R2/signing settings | Explicit fork targets; remove active --scope manaflow and upstream fallback identity |

CMUX_APP_ORIGIN and CMUX_TEAM_INVITE_ORIGIN are read by current team code; a general canonical contract and its central validation still need to be implemented. Setting these env keys alone does not change production native pins or other hardcoded links.

Provider project keys can be inlined into public frontend/native build artifacts; provider secret/server keys cannot. NEXT_PUBLIC values are build inputs, so changing Vercel runtime settings requires a rebuild to update the browser bundle.

Webhook routes to register include /api/webhooks/stack and the actual selected Stripe endpoints under web/app/api/stripe. Verify the event lists, signing secrets and delivery behavior from current code; do not blindly configure every copied upstream webhook.

## Decisions to record before release

The primary origin and fork repository are settled by the user. Use the proposed auxiliary domains and fresh fork state as planning defaults. Record actual account IDs, staging origin, registered app identity/callback schemes, support sender, billing products and enabled service set before building release artifacts.

The plan assumes full Cloud feature parity. If an optional feature will intentionally be unavailable, make that a visible, explicit product/config choice and prove it fails without upstream traffic; missing credentials cannot silently activate a shared upstream service.

If existing fork users or VMs must move, replace the fresh-state assumption with an approved data migration and rehearse it. No credentials or data are imported from upstream by this task.

## Risks and controls

| Observed source dependency | Control |
| --- | --- |
| Native production pins bypass ambient API overrides | Change trusted build config and prove stale env values are ignored |
| Shared AuthConfig contains upstream auth IDs and callback/API defaults | Inject owned config and align composition roots; reset stale project sessions |
| iOS local API config falls back to shared upstream staging for Cloud | Replace hosted default and assert loopback fallback targets fork staging |
| Worker deploy scripts pin upstream account/project IDs and known version IDs | Bootstrap explicit fork first-deploy policy; keep ownership and compatibility checks |
| Freestyle manifest IDs are account-scoped | Bake and validate snapshots with the actual fork credential |
| Strict guest firewall permits files.cmux.com | Replace exact required host set before baking restricted-machine images |
| Artifact verifier pins upstream repo, host and signer | Publish from fork and retarget verification without allowing unsigned binaries |
| Sparkle/updater feeds refer to upstream releases | Fork feed/signing configuration before any client distribution |
| Upstream identity can remain in keychain/caches | Isolate fork identity and implement scoped auth/Cloud reset |
| Request Host can influence some generated URLs | Centralize trusted production origin and test host-spoof/open-redirect cases |
| Existing Vercel branch policy deploys main only | Configure a usable fork staging/preview route with authentication protection |
| Fresh Iroh DO namespaces differ from upgraded namespaces | Separate first deployment from upgrades; preserve established fork state |
