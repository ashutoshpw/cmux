# Owned authentication

The app hosts Better Auth 1.7.7 with a bounded PostgreSQL pool. The app's existing
Drizzle version is unchanged. Apply `20261014113000_better_auth_fork` through the
protected migration workflow before enabling sign-in. Runtime initialization and
Vercel builds never apply migrations or register clients.

Set a stable, independent `BETTER_AUTH_SECRET` of at least 32 characters for each
environment, `DATABASE_URL`, and the approved `BETTER_AUTH_URL`/`CMUX_APP_ORIGIN`.
Email sign-in, verification and recovery require `RESEND_API_KEY` and an owned
`CMUX_AUTH_FROM_EMAIL`. Google and GitHub are available only when both provider
credentials are configured. Authentication email follows the requested supported
web language and defaults to English.

Purchase verification and recovery use the official magic-link plugin, with
hashed verification tokens and single-use links that expire in fifteen minutes.
Every enabled primary sign-in method uses the same TOTP challenge for accounts
with MFA enabled. The provider deletes its provisional session before returning
the challenge; OAuth and API access resume after successful factor verification.
Magic links and social callbacks redirect to the TOTP form while preserving the
approved return destination. Remembered devices use the provider's signed,
revocable trust records.

The OAuth issuer is `<origin>/api/auth`; the API resource and audience is
`<origin>/api`. Native public clients use Authorization Code, S256 PKCE and
`openid profile email offline_access cmux:api`. Access tokens last five minutes;
refresh tokens rotate. Public client IDs and callback URIs are seeded exactly by
the reviewed migration. Native sign-out deletes the source session and its grants,
so unexpired JWTs fail the next resource read. Ordinary OAuth JWT access tokens
are self-contained; use the native sign-out API for immediate session revocation.

`/api/native-auth/session` returns current user/session/organization state.
Organization selection and sign-out use its sibling POST routes. Resource access
checks signatures, issuer, audience, active client, current session, deletion state
and current memberships. Anonymous sessions can support purchases but cannot use
the native API or create organizations. Organization mutations use the app's team
services so membership revocation and last-admin rules have one owner. API key
authentication and the retired upstream CLI/device flow are unavailable.

## Local native development

After applying the auth migration to your local database, explicitly register the
native development client. Both the application and database hosts must be loopback;
this command refuses deployed/production runtimes and never prints database URLs.

```sh
CMUX_APP_ORIGIN=http://localhost:3777 \
DATABASE_URL=postgresql://cmux:cmux@localhost:13777/cmux \
bun run auth:seed-local-oauth -- \
  --client-id cmux-w3dev-macos-dev-example \
  --redirect-uri cmux-w3dev-example://auth-callback
```

The client ID and callback must match the tagged native build exactly. The tool
links that client to the exact local API resource. It refuses to rewrite an
existing client with different settings. Repeating the same registration is safe.
The tool also links the migration's fixed web client to the same local resource
for authenticated browser forwarding.

Production and staging tagged clients require a reviewed migration with exact
client IDs/callbacks, `native` application type, `none` client authentication,
mandatory PKCE and an explicit resource link. No wildcard callbacks or dynamic
client registration are enabled. The local registration command cannot target
those databases.

## Validation

`tests/better-auth-db-behavior.test.ts` runs with `CMUX_DB_TEST=1` against a migrated
disposable PostgreSQL database. It exercises the actual OAuth code exchange,
refresh rotation, current membership reads, session revocation, account deletion,
anonymous restrictions, TOTP-gated passwordless sign-in, concurrent administrator
deletion and VM authentication entrypoints. The mail and retired
provider tests run without external infrastructure. This evidence does not
establish hosted email delivery, physical passkeys, Apple callbacks or production
deployment behavior.
