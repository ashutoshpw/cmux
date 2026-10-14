# cmux-presence

Realtime device presence and connectivity invalidation service. One
`TeamPresence` Durable Object per team owns presence, and one separately named
object per verified user owns revision-only connectivity invalidations. Hosts
announce heartbeats; clients subscribe to explicit online/offline transitions.
Design, decision memo, and client integration: `docs/presence-service.md`.

## API

All `/v1` routes require `Authorization: Bearer <owned OAuth access token>` and
accept optional team scoping via `X-Cmux-Team-Id` or `?teamId=` (must be a
team the caller belongs to; defaults to the selected team, then the
solo-account user id).

| Route | Method | Purpose |
| --- | --- | --- |
| `/healthz` | GET | liveness (no auth) |
| `/v1/presence/heartbeat` | POST | announce an app instance; `{deviceId, platform, tag?, displayName?, capabilities?, stopping?}`; `stopping: true` is a clean-shutdown goodbye. Also mirrored into the caller's own device room (best-effort) |
| `/v1/presence/snapshot` | GET | one-shot presence map |
| `/v1/presence/subscribe` | GET | WebSocket upgrade or SSE stream: `snapshot` first, then `online` / `offline` / `seen` events. Team-scoped by default; `?scope=account` streams only the verified user's own devices, whatever team each selected (macOS My Devices) |
| `/v1/connectivity/subscribe` | GET | quiet WebSocket isolated by the verified owned user; carries only route-revision invalidations |
| `/v1/connectivity/invalidate` | POST | backend-only publication of `{revision}` to every connected Mac and iPhone for the verified owned user |
| `/v1/control/socket` | GET | account control-plane WebSocket (`AccountControlPlane` DO, one per verified owned user): revisioned `directory` / `hint_update` / `relay_passes` / `snapshot_complete` facts per the frozen `schemas/control-plane/` contract |

The heartbeat response returns `heartbeatIntervalMs` (15s) and
`offlineTimeoutMs` (45s); hosts should follow the returned cadence rather than
hardcoding it. An instance that misses heartbeats for the timeout window is
flipped offline by the Durable Object alarm with `reason: "timeout"`.

Every server boundary reduces Iroh routes to the EndpointID plus an exact
managed relay URL. Direct addresses and private-network hints remain on the
device or move endpoint-to-endpoint after admission. Existing LAN, Tailscale,
and custom-network route bodies pass through unchanged for compatibility.

Presence still sends the full sanitized route body in `online`, `routes`, and
snapshot frames. Current iOS clients write that body into their paired-Mac store
and reconnect without a registry round trip. Replacing it with a routes-changed
signal requires a new client protocol plus an authenticated fetch or local
rendezvous path, so that protocol change is intentionally separate.

Devices are owner-bound, mirroring the registry route: the first authenticated
user to announce a `deviceId` owns it, and a heartbeat for that device from a
different team member is rejected with `403 device_owner_mismatch`, so a
co-member cannot forge another member's device online or goodbye it offline.

Connectivity invalidation is separate from team presence because Iroh routes
belong to the personal owned account even when two devices select different
teams. The worker derives a dedicated Durable Object id from the verified user
id, pins that same id in every socket attachment, and accepts only one bounded
wire shape: `{type:"connectivity.invalidate", protocolVersion:1, revision, at}`.
No route, binding, endpoint, or path data crosses this channel. Mac and iPhone
use the revision only to fetch and atomically install the complete
`/api/connectivity/v2/sync` snapshot. Delivery is best-effort, so sleeping
devices and reordered frames affect refresh latency rather than correctness.
Publication also requires the server-only
`X-Cmux-Connectivity-Publisher-Secret`, matched against the Worker's
`CONNECTIVITY_INVALIDATION_SECRET`; a native client access token cannot forge
a revision.

The control plane (`/v1/control/socket`) is the successor channel: instead of
a bare revision nudge, one `AccountControlPlane` Durable Object per verified
owned user streams the facts themselves. On `hello` the DO replies `hello_ack`
and streams each fact as it becomes ready: `directory` (proxied server-side
from `GET api/devices/iroh` with the connection's own bearer token, one
immediate retry on connection-level failure), `relay_passes` when the hello
asked for them (proxied from `POST api/relay/token`, body `{"endpointId"}`),
then `snapshot_complete` carrying the account route revision. A `hello` whose
`haveRev` equals the current revision skips the directory body
(`resumedFromRev`). While sockets are connected a 60s alarm re-fetches
discovery and broadcasts `hint_update`/`directory` deltas; `publish_hint` is
an instant-propagation announcement fanned out to the account's other sockets
and confirmed against broker truth a few seconds later (phase A never writes
hints upstream — hint registration stays the Mac's own signed HTTPS flow).
Upstream failures produce `error` frames with `retryable`, never a dropped
socket; cached facts keep serving. The DO holds no credentials of its own:
every upstream call uses the connecting socket's bearer, stored per-socket and
deleted at close/expiry, with stream lifetime capped at token expiry like the
other subscribe routes. Wire contract: `schemas/control-plane/*.schema.json`
with generated types in `src/generated/controlPlane.ts` (regenerated by
`scripts/gen-control-plane-types.sh`, drift-guarded in CI). The Vercel origin
is the configured `CMUX_AUTH_ORIGIN`; `CMUX_WEB_BASE_URL`, when set, must match it. Redirects are rejected before any bearer forwarding. Production points to `https://cmux.w3dev.app`, and the distinct dev Worker points to `https://staging.cmux.w3dev.app`.

## Develop

```bash
bun install
bun run typecheck
bun test
bun run dev    # wrangler dev; provide owned auth config via .dev.vars or --var
```

`CMUX_AUTH_ORIGIN` is a public origin in each Wrangler configuration. Local overrides must use an explicitly registered owned hosted authority. OAuth sessions are checked live via `/api/native-auth/session`; no positive authorization cache is used.

## Deploy

Deploys run from `.github/workflows/presence.yml` via manual dispatch on
main: `gh workflow run presence.yml` deploys production, and
`gh workflow run presence.yml -f target=dev` deploys the shared
`w3dev-cmux-presence-dev` baseline, both with the repository's Cloudflare secrets
(no personal Cloudflare account membership needed). `wrangler deploy` applies
the `[[migrations]]` block atomically with the upload, so Durable Object
storage classes can never lag the deployed code.

Required GitHub repository secrets:

- `CLOUDFLARE_API_TOKEN`: API token with Workers Scripts:Edit on the account.
- `CLOUDFLARE_ACCOUNT_ID`: the Cloudflare account id.

The Worker secret `CONNECTIVITY_INVALIDATION_SECRET` and web server secret
`CMUX_CONNECTIVITY_INVALIDATION_SECRET` must contain the same random value of
at least 32 characters.

Set `SENTRY_DSN` separately for each owned Worker when telemetry is enabled.

### Staging instance

`wrangler.dev.toml` names the isolated `w3dev-cmux-presence-dev` Worker and sets both auth and API origins to `https://staging.cmux.w3dev.app`. Deploy with that configuration so its Durable Object namespaces remain separate from production:

```bash
bunx wrangler deploy --config wrangler.dev.toml
```

Provision the owned custom domain `presence.staging.cmux.w3dev.app` in the fork's Cloudflare account before using it from native clients. No owned domain or Worker is provisioned by these source changes.

The former `scripts/deploy-dev.sh` and `scripts/local-proof.sh` workflows required upstream provider credentials and are retired. Hosted dogfood requires a provisioned owned auth issuer, a registered native OAuth/PKCE client, and an isolated Worker pointing to that same issuer. Use the owned staging deployment and its scoped secrets for that validation.

For a tagged native build, set `CMUX_PRESENCE_BASE_URL` (Mac launch environment) or `CMUXPresenceBaseURL` (iOS Info.plist) to the isolated owned presence endpoint. Keep every device in that dogfood run on the same Worker.
