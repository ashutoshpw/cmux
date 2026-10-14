#!/usr/bin/env bash
# Regression test: a checkout that was not created through cmuxterm-hq has no
# scripts/dev-backend.sh, so a tagged reload needs an explicit way to build
# against the local dev origin instead of exiting before the build starts.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# shellcheck source=scripts/lib/dev-backend-origin.sh
source "$ROOT_DIR/scripts/lib/dev-backend-origin.sh"

CHECKOUT="$(mktemp -d)"
trap 'rm -rf "$CHECKOUT"' EXIT
mkdir -p "$CHECKOUT/scripts"
LOCAL_ORIGIN="http://localhost:4123"

fail() { echo "FAIL: $*" >&2; exit 1; }

# A fork checkout defaults to its local origin without an upstream helper.
unset CMUX_DEV_BACKEND_URL CMUX_DEV_BACKEND_MODE
out="$(cmux_resolve_tagged_backend probe "$CHECKOUT" "$LOCAL_ORIGIN")" \
  || fail "default local mode failed without the shared backend helper"
[[ "$out" == "$LOCAL_ORIGIN" ]] || fail "default local mode resolved '$out'"
echo "PASS: default mode resolves the local origin without a shared backend"

# Opt-in: local mode returns the local dev origin and needs no helper.
out="$(CMUX_DEV_BACKEND_MODE=local cmux_resolve_tagged_backend probe "$CHECKOUT" "$LOCAL_ORIGIN")" \
  || fail "local mode failed without the shared backend helper"
[[ "$out" == "$LOCAL_ORIGIN" ]] || fail "local mode resolved '$out', expected '$LOCAL_ORIGIN'"
echo "PASS: CMUX_DEV_BACKEND_MODE=local resolves the local dev origin"

# Local mode must not quietly accept a shared URL, and an unknown mode is an error.
if CMUX_DEV_BACKEND_MODE=local CMUX_DEV_BACKEND_URL="https://staging.cmux.w3dev.app/" \
    cmux_resolve_tagged_backend probe "$CHECKOUT" "$LOCAL_ORIGIN" >/dev/null 2>&1; then
  fail "local mode accepted CMUX_DEV_BACKEND_URL"
fi
if CMUX_DEV_BACKEND_MODE=bogus cmux_resolve_tagged_backend probe "$CHECKOUT" "$LOCAL_ORIGIN" >/dev/null 2>&1; then
  fail "an unknown CMUX_DEV_BACKEND_MODE was accepted"
fi
echo "PASS: local mode rejects a shared URL, and unknown modes are rejected"

# Remote mode requires an explicit owned application origin.
out="$(CMUX_DEV_BACKEND_MODE=remote CMUX_DEV_BACKEND_URL="https://staging.cmux.w3dev.app" \
  cmux_resolve_tagged_backend probe "$CHECKOUT" "$LOCAL_ORIGIN")" || fail "shared URL no longer resolves"
[[ "$out" == "https://staging.cmux.w3dev.app/" ]] || fail "shared URL resolved to '$out'"
echo "PASS: remote mode accepts an explicit owned application origin"

# The caller contract in reload.sh. The resolver tests above would still pass if
# reload.sh stopped handing over its local origin, or baked a shared backend URL
# into a local-mode app, so pin both.
RELOAD="$ROOT_DIR/scripts/reload.sh"
grep -Fq 'cmux_resolve_tagged_backend "$TAG_SLUG" "$PWD" "$CMUX_DEV_ORIGIN"' "$RELOAD" \
  || fail "reload.sh must pass its local dev origin to cmux_resolve_tagged_backend"
awk '
  /if \[\[ "\$\{CMUX_DEV_BACKEND_MODE:-local\}" != "local" \]\]; then/ { guarded = 1; next }
  guarded && /export CMUX_DEV_BACKEND_URL="\$CMUX_DEV_ORIGIN"/ { found = 1 }
  guarded && /^  fi$/ { guarded = 0 }
  !guarded && /export CMUX_DEV_BACKEND_URL=/ { unguarded = 1 }
  END { exit (found && !unguarded) ? 0 : 1 }
' "$RELOAD" || fail "reload.sh must export CMUX_DEV_BACKEND_URL only outside local mode"
echo "PASS: reload.sh passes its local origin and never exports a backend URL in local mode"
