# Status

- **State:** source implemented; final review and draft delivery in progress
- **Updated:** 2026-10-14

## Source and verification

Better Auth Organization/OAuth Provider/PKCE replaces live Stack integration for web, native apps and Workers. Production uses https://cmux.w3dev.app with distinct fork bundles/callbacks. The Vercel workflow pins W3Dev/vercel-deploy and the exact supplied team/project IDs. No operational upstream fallback is intended.

Settled web suite: 5053 passed, 483 database-gated skips, zero failures. Independent parent PostgreSQL runs: 25 auth tests, 2 authority/credit tests and 15 team transaction/admin/admission tests passed. All 401 portable Worker tests, typechecks and contract/boundary checks passed. Repository preflight passes 16 checks. Source build passes only with environment validation bypassed. See references/implementation.md for detailed scope, review evidence and gates.

Initial and second reviews surfaced twenty defects; repairs cover MFA, verification, organization revocation/deletion, transaction reuse, OAuth ownership, native identity/signing, distribution channels and cache defaults. Native repair review returned ship. A further server finding reproduced the personal-organization deletion race through all five admission paths; a shared locked guard repairs it. Final independent repair review returned ship for tree 7567025e6f047ec1b04d17877bb8f89735fed6e4. The source build passes with environment validation bypassed; the final full-suite replay passed. The disposable test database has been removed. Every delegation requested gpt-6.1-sol; runtime model metadata is not observable.

## Delivery and release boundaries

Implementation is isolated at /home/ashutosh/.worktrees/ashutoshpw/cmux/fork-cloud-origin. The original checkout's conflicted session-save rebase is preserved. Fork main is substantially older than the inspected source baseline and has a separate session-save commit. Draft delivery uses a snapshot base; do not force-update main or silently drop that feature.

No hosted deployment, production migration, provider provisioning, DNS change or native build/launch is established. Production release still needs owned secrets, protected migrations, exact native OAuth registrations, Apple signing/APNs/App Store configuration, Worker/bootstrap receipts and promoted VM artifacts/images/relays. Retired API-key/Vault device flows and Stack operator entrypoints remain explicitly unavailable.
