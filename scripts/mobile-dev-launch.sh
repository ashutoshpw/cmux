#!/usr/bin/env bash
set -euo pipefail

# The former Stack password-injection launcher cannot establish the fork's
# OAuth/PKCE session. Do not read credentials or mutate a simulator/device.
echo 'error: automatic password sign-in is retired for the W3Dev fork.' >&2
echo 'Build/install a tagged app, register its exact OAuth callback, and complete Better Auth sign-in in the system browser.' >&2
echo 'Use ios/scripts/reload.sh for tagged builds or scripts/ios-sim-install.sh for prebuilt simulator apps.' >&2
exit 2
