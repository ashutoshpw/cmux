# Authentication provider decision

**Updated:** 2026-10-14
**State:** Better Auth adopted; implementation resumed at the user's request.

## Confirmed decisions

- Production application origin: https://cmux.w3dev.app; no cmux.com fallback.
- Repository: github.com/ashutoshpw/cmux.
- Distribution uses distinct fork app identities and callback schemes.
- Hosting uses Vercel. Production deployment uses W3Dev/vercel-deploy with hardcoded team_bhbVYR6BqVYMXKwAp7F1k5ib / prj_3z4VuRVvSvlm5LYNnEuqHa4FKKtn; see vercel-workflow.md.
- Better Auth Organization and OAuth Provider/PKCE adopted for web, macOS, iOS, and Workers.
- All delegation and reviews use gpt-6.1-sol per user request.

## Current implementation receipt

The isolated fork-cloud-origin worktree is based on cdbe99596fe13784ec5ea24d2e1c720a8f67f5cb. Its only implementation commit is be30ba2987c, containing the failing team-origin regression and task documents. Production source changes are now in progress. Provider configuration and deployment have not been changed; nothing has been pushed. Better Auth and plugins are pinned to 1.7.7. The original session-save rebase remains untouched.

## Better Auth fit

Better Auth is an authentication framework hosted by the application owner. It can run in the existing Next.js web application at /api/auth, with the application's PostgreSQL database using the supported built-in pg.Pool adapter. The repo's Drizzle beta is outside the supported auth adapter range; schema declarations and reviewed SQL migrations remain in the existing database workflow. Using it does not require a Stack/Hexclave project or a Better Auth hosted account for this architecture.

This is an auth-provider migration in addition to the domain migration. The current web, macOS/iOS, CLI and Worker integrations depend on Stack session tokens, project identity, team membership, identity snapshots, webhooks and some VM credit operations. These integrations must move together before claiming Cloud parity.

## Adopted architecture

- Web: Better Auth cookie sessions and sign-in pages on the primary app origin.
- Native apps: Better Auth OAuth Provider plugin plus JWT support; administrator-registered public native clients, Authorization Code + S256 PKCE, exact callback URIs, offline_access where refresh tokens are needed. Native apps have no client secret.
- macOS/iOS: a Swift adapter behind the existing AuthClient protocol; system authentication browser, callback state validation, Keychain token storage and matching server revocation.
- APIs/Workers: verify issuer, audience, signature and expiry for OAuth access tokens; perform current organization/membership/grant checks independently. Local JWT verification alone does not provide immediate revocation or current authorization.
- Tenant model: map each existing cmux team concept to a Better Auth organization. Better Auth optional teams are subgroups of organizations and should not accidentally become the top-level ownership scope. Create a personal organization when needed to preserve current personal-machine behavior.
- Billing: preserve owned Stripe subscriptions and implement equivalent entitlement and VM-create-credit accounting in application-owned transactional storage. Better Auth organization support does not replace Stack payment-item APIs.
- CLI: consider the OAuth device authorization grant for terminal-only login after the native/web contract is established.

Recommended distinct identities are app.w3dev.cmux (Mac), app.w3dev.cmux.ios (iOS), with separately registered callback URIs such as cmux-w3dev://auth-callback and cmux-w3dev-ios://auth-callback. Exact values still need Apple registration and server/client alignment.

The Bearer plugin supports bearer session authentication but does not by itself define the OAuth access/refresh-token architecture required by the current native and Worker flows. Prefer a deliberate OAuth provider contract over carrying browser session tokens through custom callbacks.

## Setup prerequisites

| Requirement | Owner input or implementation decision |
| --- | --- |
| HTTPS deployment | Owned web deployment and DNS/TLS for primary and staging domains; auth runs in the existing web backend |
| PostgreSQL | Owned production/staging databases, suitable connection pooling, backups and protected schema migrations |
| ORM compatibility | Pin Better Auth/plugin versions compatible with the repo's current Drizzle version; choose the appropriate supported adapter |
| Canonical config | BETTER_AUTH_URL=https://cmux.w3dev.app; explicit approved trusted origins; no arbitrary request-host destination |
| Auth secret | At least 32 characters with high entropy, kept stable and stored in provider secret stores; separate production and staging values |
| Auth schema | Core user/session/account/verification tables; organization/member/invitation tables; JWT/OAuth plugin tables; avoid collisions with current schema |
| Email | Verified sender domain and email delivery service for chosen OTP/magic-link/password-reset/invite flows |
| Social sign-in | OAuth apps and server-side credentials for only the selected providers (Google/GitHub/Apple); exact redirect registration |
| Native sign-in | Public OAuth client IDs, exact fork callbacks, PKCE/state, refresh/revocation policy and protected local token storage |
| Access model | Organization roles, personal-org provisioning, active organization selection, VM ownership and membership-removal handling |
| Operations | Shared rate limiting appropriate to multi-instance hosting, logging, email retry policy, signing-key rotation, session expiry and revocation |
| State migration | Default fresh fork users; if existing fork users must remain, approve a separate account/team/data mapping and reauthentication plan |

Social OAuth credentials are optional if launch uses email-only auth. Email delivery is required for the selected verification/recovery flows. Apple signing/APNs/App Store setup is independent from choosing Better Auth and is needed for the corresponding distribution/mobile features.

Use the Better Auth CLI to generate the schema for the selected plugins, then review and apply it through the repository's Drizzle/protected migration workflow. Do not run database migrations at route startup or during a Vercel build.

## Repo boundaries to replace

- web/app/lib/stack.ts and stack-client.ts: browser/server auth construction and session reads.
- web/services/vms/auth.ts: bearer verification, X-Stack-Refresh-Token handling and authenticated principals.
- web/services/auth: issuer/JWKS verification, identity snapshots, revocations and Stack/Hexclave webhook mirrors.
- web/services/teams and VM ownership consumers: organization/member/role semantics and current membership checks.
- web/services/vms/billingGateway.ts: Stack payment items used for VM credits.
- Packages/Shared/CmuxAuthRuntime: StackAuthClient, coordinator/token storage semantics and provider-specific errors.
- Native composition roots and callback handlers: fork identity and OAuth login/refresh/revocation.
- workers/presence and workers/iroh-v2: identity and project/environment scope verification.

## Decisions before restarting

1. Select Better Auth versus continuing with Stack/Hexclave.
2. Select initial login methods (recommend email sign-in plus one social provider if desired).
3. Select native OAuth/OIDC architecture and token/revocation policy.
4. Confirm owned hosting/database/email accounts and fresh-user versus existing-fork-user state.
5. Decide initial billing/VM credit behavior and organization roles.
6. Register final fork app identities, callbacks and public OAuth clients.

If Better Auth is selected, revise the main migration plan and tests around these contracts before production edits. Owned Vercel/Cloudflare/Freestyle/storage/signing setup is still required for the corresponding Cloud features; changing auth providers does not provision those services.

## Documentation evidence

Official documentation was fetched on 2026-10-14. The documentation index reports the current stable line as 1.7; no Better Auth dependency has been installed in this repo. Pin an actual compatible package/plugin version before implementation.

- [Installation](https://better-auth.com/docs/installation) — hosting, secret, base URL, database and Next.js handler.
- [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle) — PostgreSQL adapter and schema generation/migration.
- [OAuth provider](https://better-auth.com/docs/plugins/oauth-provider) — public native clients, exact redirects, PKCE, refresh, revocation and JWT verification.
- [JWT plugin](https://better-auth.com/docs/plugins/jwt) — issuer/audience, signing keys and JWKS; follow OAuth-provider-specific token endpoint configuration.
- [Organization plugin](https://better-auth.com/docs/plugins/organization) — organizations, memberships, roles and optional teams.
- [Bearer plugin](https://better-auth.com/docs/plugins/bearer) — bearer session-token support and its separate contract.
