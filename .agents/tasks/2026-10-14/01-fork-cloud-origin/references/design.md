# Destination and configuration design

## Required contract

Production web, authenticated API, Cloud VM backend, device registry, push API, billing, account/team pages, native sign-in, and browser session handoffs use exactly https://cmux.w3dev.app. Preserve route paths and wire protocols unless an observed incompatibility requires a separate repair.

Production and production-auth builds ignore stale CMUX_API_BASE_URL, CMUX_VM_API_BASE_URL, CMUX_WWW_ORIGIN, and related ambient values pointing upstream. They also reject untrusted destinations for credential-bearing operations. Debug builds retain explicit local development support; all hosted development defaults point at fork services.

Apply this rule to persisted service overrides and remotely fetched client config as well: old presenceServiceURL preferences, cached discovery/relay data, SDK provider URL overrides and client-config service links must not bypass trusted production routing. Preserve explicit user-selected SSH/browser destinations, which are separate from managed Cloud services.

No operation may fall back to cmux.com or its subdomains after a timeout, HTTP error, missing config, failed auth, missing artifact, or empty response. Remove old host aliases as positive trust entries. An old-origin redirect must be rejected before credentials are forwarded. Rollback never restores upstream destinations.

## Proposed destination map

Only the primary production domain is supplied by the user. Other names below are proposed defaults to provision and verify; they are not claims about existing DNS.

| Role | Proposed destination | Treatment |
| --- | --- | --- |
| Production web and first-party APIs | https://cmux.w3dev.app | Required and fixed |
| Hosted staging | https://staging.cmux.w3dev.app | Separate auth project, database, provider and Worker scope |
| Artifact downloads and update feeds | https://files.cmux.w3dev.app | Fork R2 or equivalent object storage; signed fork manifests |
| Production presence/control socket | https://presence.cmux.w3dev.app | Fork Cloudflare Worker + Durable Objects |
| Production Iroh v2 control plane | https://iroh.cmux.w3dev.app | Fork Worker; retain /v2 route contracts |
| Hosted staging Workers | staging-specific fork hosts | No debussy.workers.dev or upstream staging defaults |
| Managed VM publications | <vm>--<org>--<port>.vm.cmux.w3dev.app | Verified wildcard zone owned by the fork; separate from credential-bearing app host |
| Iroh relay data plane | explicit fork relay catalog | Provision regional relay hosts under relay.cmux.w3dev.app |
| CI caches | fork-owned cache endpoint | Missing cache becomes a cache miss; never reads upstream cache as a recovery path |
| CodeRouter control/data plane | https://cmux.w3dev.app with existing paths | Verify /v1 and handoff routes on primary host; if a separate host is required, configure a fork host explicitly |
| Hosted Subrouter | explicit fork endpoint | Replace sr.cmux.com/subrouter.cmux.dev defaults and retarget tenancy/auth |
| Model catalog | https://cmux.w3dev.app/api/agent-models | Replace agent-chat/catalog.ts default |

VM publication subdomains must not share broad Domain cookies with the app: keep auth cookies host-only. Confirm wildcard DNS and certificate depth explicitly; a certificate for *.w3dev.app does not cover files.cmux.w3dev.app.

The web domain does not become the Stack/Hexclave provider API URL. The native Stack client currently defaults to api.stack-auth.com. The web SDK and REST helpers currently resolve api.hexclave.com, while token verification separately resolves the Stack issuer. Configure these from actual provider/project behavior and verify issuer/JWKS/audience. Do not point provider SDKs or issuer checks at the application domain just because the website moved.

## One deployment source

Add a small nonsecret manifest at config/fork-deployment.json (proposed new file), containing approved production/staging origins, service origins, GitHub repository, public auth project IDs/keys, publication zone, and references to the relay catalog. Keep provider secrets, signing secrets, database URLs, webhook secrets, and OAuth client secrets out of this file.

Generate the needed Swift, TypeScript, xcconfig, and shell/build inputs from that manifest. Put outputs beside existing config owners, and provide deterministic --check validation so hand edits cannot introduce divergence. Generate the existing managed relay consumers from config/iroh/managed-relay-catalog.json rather than editing generated copies.

Rust/Go hosted clients and VM payload builders must consume or generate their managed defaults from the same manifest through build inputs. Keep service protocol adapters in their existing language/module owners; centralizing the values does not require rewriting the clients.

Use existing value types and constructor injection in native composition roots. Keep generated data separate from behavior. Do not introduce a singleton, namespace enum, unrelated package extraction, or duplicate runtime config registry. Keep app-linked code Swift 6.0 compatible. If a new Swift file is needed, wire the affected app/test targets through the repository's existing tools.

Validate production origins as bare HTTPS origins with no userinfo, path, query or fragment. Distinguish missing optional-service config from malformed config. Both must be explicit; neither can select upstream. A required release input missing a fork value fails the build/deployment rather than baking an upstream project or URL.

For the web server, integrate CMUX_APP_ORIGIN and existing specialized env keys with validated canonical config. Reject conflicts between production env and the approved origin. Avoid constructing credential/email destinations from arbitrary Host or forwarded headers. Preview/localhost support remains a separately scoped development policy.

## Native application identity

Recommended shipping identity: use a fork bundle ID such as app.w3dev.cmux, corresponding iOS IDs/app groups/keychain groups, and a fork callback scheme such as cmux-w3dev. These are proposed values pending Apple registration.

Update the native callback producers and the server's exact callback-scheme allowlist together. Preserve state matching, server handoff nonce, callback host/path checks, and tagged debug restrictions. Do not admit every custom scheme or relax localhost restrictions to make fork sign-in work.

If the fork intentionally retains existing bundle IDs, require an explicit distribution decision first: signing, keychain access, updates, and callback ownership can collide with the installed upstream application. Development verification always uses an isolated tagged build, never the user's running installed cmux.

Verify actual callback paths before changing shared defaults: AuthConfig currently names /auth/callback, while native browser sign-in enters /handler/native-sign-in and returns through /handler/after-sign-in. Email verification uses /handler/email-verification. Exercise these flows against the provider rather than mechanically inventing a callback path.

## Sessions and state

Default to new fork auth projects and fresh fork databases/provider inventory. Upstream users, teams, plans, provider snapshot IDs, VMs, grants and signing keys do not become usable because the hostname changed.

New auth project IDs require a deliberate session reset. Scope cached tokens, browser priming, device registrations, team selection, discovery and tunnel caches by fork origin/project. Reset only affected auth/Cloud state; preserve local workspaces, user files, SSH credentials and unrelated settings.

Existing fork customers, if any, need a separately rehearsed data plan before cutover: inventory and back up state, define team/user ID mapping, subscriptions, stored origin URLs, tunnel/interface identities, publication records, leases, image ownership and callback registrations. No destructive cleanup or upstream data import is assumed.

Keep copyright/license notices, third-party attribution, historical commit/issue references and explicit negative-test examples accurate. They can contain upstream names without being operational fallback destinations. Current product links, docs examples and support/contact links should describe the fork; a support address must be verified before use.
