#!/bin/bash
# Resolve only a local development server or an explicitly configured fork host.
cmux_resolve_tagged_backend() {
  local tag="$1" checkout="$2" local_origin="${3:-}" url="${CMUX_DEV_BACKEND_URL:-}"
  case "${CMUX_DEV_BACKEND_MODE:-local}" in
    local)
      if [[ -n "$url" || -z "$local_origin" ]]; then
        echo 'Local backend mode needs a local origin and no CMUX_DEV_BACKEND_URL.' >&2
        return 1
      fi
      printf '%s\n' "$local_origin"
      ;;
    remote)
      if [[ -z "$url" ]]; then
        echo 'Remote backend mode requires an explicit fork-owned CMUX_DEV_BACKEND_URL.' >&2
        return 1
      fi
      python3 - "$url" <<'PY'
import sys
from urllib.parse import urlsplit
value = sys.argv[1]
u = urlsplit(value)
if (u.scheme != 'https' or u.hostname not in ('cmux.w3dev.app', 'staging.cmux.w3dev.app')
    or u.username or u.password or u.port not in (None, 443) or u.path not in ('', '/')
    or u.query or u.fragment):
    sys.exit('Remote development backend must be an HTTPS fork application origin.')
print(value.rstrip('/') + '/')
PY
      ;;
    *) echo 'CMUX_DEV_BACKEND_MODE must be local or remote.' >&2; return 1 ;;
  esac
}
