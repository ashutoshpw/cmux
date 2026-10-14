import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const repositoryRoot = path.resolve(import.meta.dir, "../..");

function fixtureDirectory() {
  const directory = mkdtempSync(path.join(os.tmpdir(), "cmux-prod-gate-test-"));
  chmodSync(directory, 0o700);
  return directory;
}

function run(command, args, environment = {}) {
  return spawnSync(command, args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

function writeGateAppPlist(
  appPath,
  entries,
  environmentEntries = {},
  platform = "ios",
) {
  const contents = platform === "macOS" ? path.join(appPath, "Contents") : appPath;
  mkdirSync(contents, { recursive: true });
  const values = Object.entries(entries)
    .map(([key, value]) => `<key>${key}</key><string>${value}</string>`)
    .join("");
  const environmentValues = Object.entries(environmentEntries)
    .map(([key, value]) => `<key>${key}</key><string>${value}</string>`)
    .join("");
  const environment = environmentValues
    ? `<key>LSEnvironment</key><dict>${environmentValues}</dict>`
    : "";
  writeFileSync(
    path.join(contents, "Info.plist"),
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>${values}${environment}</dict></plist>
`,
  );
}

test("release gate rejects Mac and iOS artifacts configured for different authorities", (t) => {
  const directory = fixtureDirectory();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const macApp = path.join(directory, "cmux DEV gate.app");
  const iosApp = path.join(directory, "cmux.app");
  const expected = "https://gate.example";
  const expectedV2 = "https://iroh.staging.cmux.w3dev.app";
  const presence = "https://presence.example";

  writeGateAppPlist(macApp, {}, {
    CMUX_API_BASE_URL: "https://stale.example",
    CMUX_IROH_BROKER_BASE_URL: "https://stale.example",
    CMUX_IROH_V2_BASE_URL: "https://stale.example",
    CMUX_IROH_V2_ENVIRONMENT: "development",
  }, "macOS");
  writeGateAppPlist(iosApp, {
    CMUXApiBaseURL: expected,
    CMUXIrohBrokerBaseURL: expected,
    CMUX_IROH_V2_BASE_URL: expectedV2,
    CMUX_IROH_V2_ENVIRONMENT: "staging",
    CMUXPresenceBaseURL: presence,
  });

  const mismatch = run("bash", [
    "scripts/lib/verify-iroh-release-gate-builds.sh",
    "--mac-app", macApp,
    "--ios-app", iosApp,
    "--backend-base-url", expected,
    "--v2-base-url", expectedV2,
    "--v2-environment", "staging",
    "--presence-base-url", presence,
  ]);
  assert.notEqual(mismatch.status, 0);
  assert.match(mismatch.stderr, /Mac app.*requested backend/u);
  assert.match(mismatch.stderr, /rebuild without --skip-build/u);

  writeGateAppPlist(macApp, {}, {
    CMUX_API_BASE_URL: expected,
    CMUX_IROH_BROKER_BASE_URL: expected,
    CMUX_IROH_V2_BASE_URL: expectedV2,
    CMUX_IROH_V2_ENVIRONMENT: "staging",
  }, "macOS");
  const presenceMismatch = run("bash", [
    "scripts/lib/verify-iroh-release-gate-builds.sh",
    "--mac-app", macApp,
    "--ios-app", iosApp,
    "--backend-base-url", expected,
    "--v2-base-url", expectedV2,
    "--v2-environment", "staging",
    "--presence-base-url", presence,
  ]);
  assert.notEqual(presenceMismatch.status, 0);
  assert.match(presenceMismatch.stderr, /Mac app presence.*requested backend/u);

  writeGateAppPlist(macApp, {}, {
    CMUX_API_BASE_URL: expected,
    CMUX_IROH_BROKER_BASE_URL: expected,
    CMUX_IROH_V2_BASE_URL: expectedV2,
    CMUX_IROH_V2_ENVIRONMENT: "staging",
    CMUX_PRESENCE_BASE_URL: presence,
  }, "macOS");
  const matched = run("bash", [
    "scripts/lib/verify-iroh-release-gate-builds.sh",
    "--mac-app", macApp,
    "--ios-app", iosApp,
    "--backend-base-url", expected,
    "--v2-base-url", expectedV2,
    "--v2-environment", "staging",
    "--presence-base-url", presence,
  ]);
  assert.equal(matched.status, 0, matched.stderr);
});




test("release gate iOS build is isolated from the configured default iPhone", () => {
  const result = run("bash", ["-c", [
    "set -euo pipefail",
    "source scripts/lib/iroh-release-gate-targets.sh",
    "iroh_release_gate_set_ios_reload_args prodgate 'cmux Iroh gate prodgate' SIMULATOR-ID 1",
    "printf '<%s>\\n' \"${IROH_RELEASE_GATE_IOS_RELOAD_ARGS[@]}\"",
  ].join("; ")]);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, [
    "<--tag>",
    "<prodgate>",
    "<--simulator>",
    "<cmux Iroh gate prodgate>",
    "<--simulator-id>",
    "<SIMULATOR-ID>",
    "<--simulator-only>",
    "<--prod-auth>",
    "<--no-launch>",
    "",
  ].join("\n"));
});

test("iOS release artifact gate rejects staged runtime origins", (t) => {
  const directory = fixtureDirectory();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, "cmux.app");
  const args = ["scripts/lib/verify-ios-release-origins.sh", "--app", app];

  writeGateAppPlist(app, {
    CFBundleIdentifier: "app.w3dev.cmux.ios",
    CMUXAuthEnvironment: "production",
    CMUXOAuthClientID: "cmux-w3dev-ios",
    CMUXOAuthCallbackScheme: "cmux-w3dev-ios",
    CMUXApiBaseURL: "https://cmux.w3dev.app",
    CMUXIrohBrokerBaseURL: "https://cmux.w3dev.app",
    CMUXPresenceBaseURL: "https://presence.cmux.w3dev.app",
    CMUXDevTag: "",
  });
  const valid = run("bash", args);
  assert.equal(valid.status, 0, valid.stderr);

  writeGateAppPlist(app, {
    CFBundleIdentifier: "app.w3dev.cmux.ios",
    CMUXAuthEnvironment: "production",
    CMUXOAuthClientID: "cmux-w3dev-ios",
    CMUXOAuthCallbackScheme: "cmux-w3dev-ios",
    CMUXApiBaseURL: "https://cmux.w3dev.app",
    CMUXIrohBrokerBaseURL: "https://cmux-staging.vercel.app",
    CMUXPresenceBaseURL: "https://presence.cmux.w3dev.app",
    CMUXDevTag: "internal",
  });
  const invalid = run("bash", args);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /CMUXIrohBrokerBaseURL/u);
});

test("iOS distribution artifacts require their channel's registered OAuth client", (t) => {
  const directory = fixtureDirectory();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = path.join(directory, "cmux.app");
  const args = ["scripts/lib/verify-ios-release-origins.sh", "--app", app];
  const production = {
    CMUXAuthEnvironment: "production",
    CMUXApiBaseURL: "https://cmux.w3dev.app",
    CMUXIrohBrokerBaseURL: "https://cmux.w3dev.app",
    CMUXPresenceBaseURL: "https://presence.cmux.w3dev.app",
    CMUXDevTag: "",
  };
  for (const channel of ["beta", "internal", "demo"]) {
    writeGateAppPlist(app, {
      ...production,
      CFBundleIdentifier: `app.w3dev.cmux.ios.${channel}`,
      CMUXOAuthClientID: `cmux-w3dev-ios-${channel}`,
      CMUXOAuthCallbackScheme: `cmux-w3dev-ios-${channel}`,
    });
    const matched = run("bash", args);
    assert.equal(matched.status, 0, matched.stderr);
  }
  writeGateAppPlist(app, {
    ...production,
    CFBundleIdentifier: "app.w3dev.cmux.ios.beta",
    CMUXOAuthClientID: "cmux-w3dev-ios",
    CMUXOAuthCallbackScheme: "cmux-w3dev-ios-beta",
  });
  const mismatched = run("bash", args);
  assert.notEqual(mismatched.status, 0);
  assert.match(mismatched.stderr, /CMUXOAuthClientID/u);
});



test("Mac reload documents hosted Better Auth and retires password injection", () => {
  const result = run("bash", ["scripts/reload.sh", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--prod-auth/u);
  assert.match(result.stdout, /--credentials-file <path>/u);
  assert.match(result.stdout, /Use Better Auth and Cloud APIs on cmux\.w3dev\.app/u);
  assert.match(result.stdout, /default to local backend mode/u);
  assert.match(result.stdout, /Retired password auto-login flags; rejected before build/u);
});

test("Mac reload accepts an immutable cmux-tui manifest pin", () => {
  const result = run("bash", ["scripts/reload.sh", "--help"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--cmux-tui-manifest-url <url>/u);

  const source = readFileSync(
    path.join(repositoryRoot, "scripts/reload.sh"),
    "utf8",
  );
  assert.match(
    source,
    /--manifest-url "\$CMUX_TUI_CLIENT_MANIFEST_URL_VALUE"/u,
  );
});

// Legacy password harnesses are unavailable in the fork. Executing each public
// entrypoint must stop before sourcing credentials, creating runtime state, or
// calling tooling that could provision identities, build, or launch an app.
for (const script of [
  "scripts/dev-setup.sh",
  "scripts/setup-team-dev.sh",
  "scripts/e2e/backend-up.sh",
  "scripts/run-iroh-release-gate.sh",
  "scripts/mobile-dev-launch.sh",
]) {
  test(`${script} refuses retired password auth before any side effect`, (t) => {
    const directory = fixtureDirectory();
    t.after(() => rmSync(directory, { recursive: true, force: true }));
    const fakeBin = path.join(directory, "bin");
    mkdirSync(fakeBin);
    const contacted = path.join(directory, "contacted");
    const credentials = path.join(directory, "credentials.env");
    writeFileSync(credentials, `printf secret-loaded > "${contacted}"\n`, { mode: 0o600 });
    for (const tool of ["bun", "curl", "gh", "xcrun", "xcodebuild", "defaults", "open"]) {
      writeFileSync(path.join(fakeBin, tool), '#!/bin/sh\nprintf contacted > "$CMUX_TEST_CONTACTED"\nexit 99\n', { mode: 0o755 });
    }
    const result = run("bash", [script, "--tag", "retired-probe", "--production", "--credentials-file", credentials], {
      HOME: directory,
      TMPDIR: directory,
      PATH: `${fakeBin}:${process.env.PATH}`,
      CMUX_TEST_CONTACTED: contacted,
      CMUX_CREDENTIALS_FILE: credentials,
    });
    assert.equal(result.status, 2, result.stderr);
    assert.match(result.stderr, /(?:Stack auth harness|automatic password sign-in) is retired/u);
    assert.equal(existsSync(contacted), false);
    assert.equal(existsSync(path.join(directory, "Library")), false);
    assert.equal(existsSync(path.join(directory, ".secrets")), false);
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /secret-loaded|password=|access_token/u);
  });
}

test("Mac reload refuses password auto-login before reading an explicit credential file", (t) => {
  const directory = fixtureDirectory();
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const marker = path.join(directory, "sourced");
  const credentials = path.join(directory, "credentials.env");
  writeFileSync(credentials, `printf sourced > "${marker}"\n`, { mode: 0o600 });
  const result = run("bash", ["scripts/reload.sh", "--tag", "password-probe", "--credentials-file", credentials, "--launch"], { HOME: directory });
  assert.equal(result.status, 2, result.stderr);
  assert.match(result.stderr, /password auto-login is retired/u);
  assert.equal(existsSync(marker), false);
});
