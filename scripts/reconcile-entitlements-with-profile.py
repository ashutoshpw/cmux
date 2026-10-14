#!/usr/bin/env python3
"""Reconcile a cmux entitlements file with the provisioning profile it ships with.

macOS refuses to launch a Developer ID app whose signature claims a restricted
entitlement (`com.apple.developer.*`) that its embedded provisioning profile
does not grant. The cmux entitlement files declare the *desired* state — today
that includes the Cloud tunnel capability
(`com.apple.developer.networking.networkextension` with
`packet-tunnel-provider-systemextension` plus
`com.apple.developer.system-extension.install`) — and this script produces the
*effective* entitlements for one signing run. When the profile does not grant
the tunnel, the summary reports that mismatch and release signing stops. When
the profile grants the tunnel, the two hardened-runtime relaxations that macOS
rejects in a container app carrying a packet-tunnel system extension are
removed from the app signature.

Usage:
  reconcile-entitlements-with-profile.py --entitlements cmux.release.entitlements \
      --profile "cmux.app/Contents/embedded.provisionprofile" --output /tmp/effective.plist [--json]

`--profile` accepts either the CMS-wrapped `.provisionprofile` (decoded with
`security cms -D`) or an already-decoded XML plist. `--no-profile` produces the
effective entitlements for an unprovisioned signing run, which likewise cannot
carry the tunnel feature set.

Prints a JSON summary on stdout with `--json`:
  {"tunnel_supported": bool, "dropped": [keys],
   "dropped_for_system_extension": [keys], "missing_restricted": [keys],
   "profile_app_id": str|null}

Exit codes: 0 reconciled; 1 the profile could not be read; 2 usage error.
"""
from __future__ import annotations

import argparse
import json
import fnmatch
import plistlib
import re
import subprocess
import sys
from pathlib import Path

NETWORK_EXTENSION_KEY = "com.apple.developer.networking.networkextension"
SYSTEM_EXTENSION_INSTALL_KEY = "com.apple.developer.system-extension.install"
APP_GROUPS_KEY = "com.apple.security.application-groups"
PACKET_TUNNEL_SYSTEM_EXTENSION = "packet-tunnel-provider-systemextension"

# The keys that exist only for the app-managed Cloud tunnel. They are dropped
# together: a NetworkExtension entitlement without the install entitlement (or
# the reverse) cannot run the extension either.
TUNNEL_FEATURE_KEYS = (NETWORK_EXTENSION_KEY, SYSTEM_EXTENSION_INSTALL_KEY, APP_GROUPS_KEY)

# macOS rejects these hardened-runtime relaxations on an app bundle that
# contains a packet-tunnel system extension. Keep allow-jit, which is accepted
# by macOS and is still needed by the terminal runtime.
SYSTEM_EXTENSION_INCOMPATIBLE_RUNTIME_KEYS = (
    "com.apple.security.cs.allow-unsigned-executable-memory",
    "com.apple.security.cs.disable-library-validation",
)

# Restricted entitlements the profile must grant for the app to launch at all.
# Reported (not dropped) so the operator sees a broken profile before notarization.
RESTRICTED_PREFIXES = ("com.apple.developer.",)
UNRESTRICTED_DEVELOPER_KEYS = {SYSTEM_EXTENSION_INSTALL_KEY, NETWORK_EXTENSION_KEY}


def load_profile_entitlements(path: Path) -> tuple[dict, str | None]:
    """Return (entitlements dict, application-identifier) from a profile."""
    raw = path.read_bytes()
    try:
        decoded = plistlib.loads(raw)
    except Exception:  # noqa: BLE001 - CMS-wrapped profile; decode with security(1)
        try:
            result = subprocess.run(
                ["/usr/bin/security", "cms", "-D", "-i", str(path)],
                check=True,
                capture_output=True,
            )
        except (OSError, subprocess.CalledProcessError) as exc:
            raise SystemExit(f"error: could not decode provisioning profile {path}: {exc}") from exc
        try:
            decoded = plistlib.loads(result.stdout)
        except Exception as exc:  # noqa: BLE001
            raise SystemExit(f"error: decoded profile {path} is not a plist: {exc}") from exc
    entitlements = decoded.get("Entitlements")
    if not isinstance(entitlements, dict):
        raise SystemExit(f"error: provisioning profile {path} has no Entitlements dictionary")
    app_id = entitlements.get("com.apple.application-identifier")
    return entitlements, app_id if isinstance(app_id, str) else None


def resolve_identity(entitlements: dict, profile: dict | None, bundle_id: str | None, signing_team: str | None) -> dict:
    """Resolve build variables from the exact profile; reject foreign identity grants."""
    if profile is None:
        if "$(" in repr(entitlements):
            raise ValueError("identity templates require an embedded provisioning profile")
        return dict(entitlements)
    app_id = profile.get("com.apple.application-identifier")
    team = profile.get("com.apple.developer.team-identifier")
    if not isinstance(app_id, str) or not isinstance(team, str) or not re.fullmatch(r"[A-Z0-9]{10}", team):
        raise ValueError("profile must grant an exact application identifier and a valid signing team")
    prefix, separator, profile_bundle = app_id.partition(".")
    if not separator or not re.fullmatch(r"[A-Z0-9]{10}", prefix) or "*" in profile_bundle:
        raise ValueError("profile must grant an exact application identifier")
    if bundle_id is not None and profile_bundle != bundle_id:
        raise ValueError(f"profile bundle {profile_bundle} does not match built bundle {bundle_id}")
    if signing_team is not None and team != signing_team:
        raise ValueError(f"profile team {team} does not match signing team {signing_team}")

    def resolve(value):
        if isinstance(value, str):
            value = value.replace("$(AppIdentifierPrefix)", prefix + ".").replace("$(DEVELOPMENT_TEAM)", team)
            value = value.replace("$(PRODUCT_BUNDLE_IDENTIFIER)", profile_bundle)
            if "$(" in value:
                raise ValueError(f"unresolved entitlement variable: {value}")
            return value
        if isinstance(value, list):
            return [resolve(item) for item in value]
        return value

    effective = {key: resolve(value) for key, value in entitlements.items()}
    for key, expected in (("com.apple.application-identifier", app_id), ("com.apple.developer.team-identifier", team)):
        if key in effective and effective[key] != expected:
            raise ValueError(f"desired {key} does not match embedded profile identity")
    for key in ("keychain-access-groups", APP_GROUPS_KEY):
        if key not in effective:
            continue
        grants = profile.get(key, [])
        if not isinstance(grants, list) or not isinstance(effective[key], list):
            raise ValueError(f"invalid profile grants for {key}")
        for group in effective[key]:
            if not isinstance(group, str) or "*" in group or not any(
                isinstance(grant, str) and fnmatch.fnmatchcase(group, grant) for grant in grants
            ):
                raise ValueError(f"profile does not authorize exact {key} group {group}")
    return effective


def profile_grants_tunnel(profile_entitlements: dict | None, *, requires_install: bool = True) -> bool:
    if profile_entitlements is None:
        return False
    capabilities = profile_entitlements.get(NETWORK_EXTENSION_KEY)
    if isinstance(capabilities, str):
        capabilities = [capabilities]
    if not isinstance(capabilities, list) or PACKET_TUNNEL_SYSTEM_EXTENSION not in capabilities:
        return False
    return not requires_install or profile_entitlements.get(SYSTEM_EXTENSION_INSTALL_KEY) is True


def reconcile(entitlements: dict, profile_entitlements: dict | None) -> tuple[dict, dict]:
    """Return (effective entitlements, summary)."""
    wants_tunnel = NETWORK_EXTENSION_KEY in entitlements or SYSTEM_EXTENSION_INSTALL_KEY in entitlements
    supported = wants_tunnel and profile_grants_tunnel(
        profile_entitlements, requires_install=SYSTEM_EXTENSION_INSTALL_KEY in entitlements
    )
    effective = dict(entitlements)
    dropped: list[str] = []
    dropped_for_system_extension: list[str] = []
    if wants_tunnel and not supported:
        for key in TUNNEL_FEATURE_KEYS:
            if key in effective:
                effective.pop(key)
                dropped.append(key)
    elif supported:
        for key in SYSTEM_EXTENSION_INCOMPATIBLE_RUNTIME_KEYS:
            if key in effective:
                effective.pop(key)
                dropped.append(key)
                dropped_for_system_extension.append(key)
    missing_restricted: list[str] = []
    if profile_entitlements is not None:
        for key in effective:
            if key.startswith(RESTRICTED_PREFIXES) and key not in UNRESTRICTED_DEVELOPER_KEYS and key not in profile_entitlements:
                missing_restricted.append(key)
    summary = {
        "tunnel_requested": wants_tunnel,
        "tunnel_supported": supported,
        "dropped": dropped,
        "dropped_for_system_extension": dropped_for_system_extension,
        "missing_restricted": sorted(missing_restricted),
    }
    return effective, summary


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--entitlements", required=True, type=Path, help="desired entitlements plist")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--profile", type=Path, help="embedded.provisionprofile or decoded plist")
    source.add_argument("--no-profile", action="store_true", help="signing run without a provisioning profile")
    parser.add_argument("--output", required=True, type=Path, help="where to write the effective entitlements plist")
    parser.add_argument("--bundle-identifier", help="exact CFBundleIdentifier of the bundle being signed")
    parser.add_argument("--team-identifier", help="team of the selected Developer ID signing certificate")
    parser.add_argument("--json", action="store_true", help="print a JSON summary on stdout")
    args = parser.parse_args(argv)

    try:
        with args.entitlements.open("rb") as handle:
            entitlements = plistlib.load(handle)
    except (OSError, plistlib.InvalidFileException) as exc:
        print(f"error: could not read entitlements {args.entitlements}: {exc}", file=sys.stderr)
        return 2
    if not isinstance(entitlements, dict):
        print(f"error: entitlements {args.entitlements} is not a dictionary plist", file=sys.stderr)
        return 2

    profile_entitlements = None
    profile_app_id = None
    if args.profile is not None:
        try:
            profile_entitlements, profile_app_id = load_profile_entitlements(args.profile)
        except SystemExit as exc:
            print(exc, file=sys.stderr)
            return 1

    # Drop unavailable tunnel keys before checking their group grants, so the
    # existing no-tunnel report remains useful. Identity keys always fail closed.
    effective, summary = reconcile(entitlements, profile_entitlements)
    try:
        effective = resolve_identity(effective, profile_entitlements, args.bundle_identifier, args.team_identifier)
    except ValueError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    summary["profile_app_id"] = profile_app_id
    with args.output.open("wb") as handle:
        plistlib.dump(effective, handle, fmt=plistlib.FMT_XML, sort_keys=False)

    if summary["dropped"]:
        if summary["dropped_for_system_extension"]:
            print(
                "::notice::Cloud tunnel system extensions require a restricted hardened-runtime profile; "
                "removed from the app signature: "
                + ", ".join(summary["dropped_for_system_extension"]),
                file=sys.stderr,
            )
        else:
            reason = "no provisioning profile is embedded" if profile_entitlements is None else "the provisioning profile does not grant the Cloud tunnel capability"
            print(
                f"::warning::Cloud tunnel entitlements dropped from {args.entitlements.name} because {reason}: "
                + ", ".join(summary["dropped"])
                + ". Release signing must stop. Enable Network Extensions + System Extension on the App ID and regenerate the profile.",
                file=sys.stderr,
            )
    for key in summary["missing_restricted"]:
        print(f"::warning::restricted entitlement {key} is not granted by the provisioning profile; the signed app may not launch", file=sys.stderr)
    if args.json:
        print(json.dumps(summary, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
