#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'This upstream Stack Auth workflow is retired in the owned fork.' 'Use the owned Better Auth OAuth/PKCE registration and isolated Worker configuration documented in workers/presence/README.md.' >&2
exit 1
