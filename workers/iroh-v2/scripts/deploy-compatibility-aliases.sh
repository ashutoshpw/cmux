#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' 'Upstream compatibility alias deployment is retired in the owned fork.' 'Use the distinct owned Worker names and manifest endpoints; no upstream Worker or namespace is a fork target.' >&2
exit 1
