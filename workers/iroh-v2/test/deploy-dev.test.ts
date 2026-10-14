import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Provider commands are replaced before the shell is launched; no Worker is created. */
async function probe(overrides: Record<string, string> = {}) {
  const directory = await mkdtemp(join(tmpdir(), "owned-iroh-dev-test-"));
  const bin = join(directory, "bin");
  const calls = join(directory, "provider.json");
  try {
    await mkdir(bin);
    await writeFile(join(bin, "bunx"), `#!/usr/bin/env python3
import json, os, pathlib, sys
args = sys.argv[1:]
path = args[args.index('--secrets-file') + 1]
keys = sorted(json.loads(pathlib.Path(path).read_text()).keys())
pathlib.Path(os.environ['OWNED_TEST_CALLS']).write_text(json.dumps({'args': args, 'keys': keys}))
`, { mode: 0o700 });
    for (const command of ["wrangler", "curl", "bun"]) {
      await writeFile(join(bin, command), "#!/bin/sh\nexit 97\n", { mode: 0o700 });
    }
    const child = Bun.spawn(["/bin/bash", join(import.meta.dir, "../scripts/deploy-dev.sh"), "validation-branch"], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        OWNED_TEST_CALLS: calls,
        CMUX_FORK_CLOUDFLARE_ACCOUNT_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        CLOUDFLARE_ACCOUNT_ID: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        CMUX_IROH_V2_WORKERS_SUBDOMAIN: "owned-test",
        CMUX_AUTH_ORIGIN: "https://staging.cmux.w3dev.app",
        CMUX_AUTH_SERVICE_KEY: "local-fixture-owned-service-key",
        API_TICKET_KEYS: "local-fixture-ticket-keys",
        API_TICKET_CURRENT_KEY_ID: "local-fixture-kid",
        RELAY_SIGNING_KEY: "local-fixture-relay-key",
        RELAY_KEY_ID: "local-fixture-relay-kid",
        RELAY_URLS: "[]",
        DATABASE_URL: "postgresql://fixture:fixture@database.example.test/db",
        STACK_PROJECT_ID: "retired-project",
        STACK_PUBLISHABLE_KEY: "retired-public",
        STACK_SERVER_KEY: "retired-server",
        ...overrides,
      }, stdout: "pipe", stderr: "pipe",
    });
    const [exit, output] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    const recorded = await readFile(calls, "utf8").then(text => JSON.parse(text) as { args: string[]; keys: string[] }).catch(() => null);
    return { exit, output, recorded };
  } finally { await rm(directory, { recursive: true, force: true }); }
}

test("isolated owned deployment publishes only owned auth secrets and the canonical database alias", async () => {
  const result = await probe({ DATABASE_URL: "", PLANETSCALE_DATABASE_URL: "postgresql://fixture:fixture@database.example.test/db" });
  expect(result.exit).toBe(0);
  expect(result.recorded?.args).toContain("w3dev-cmux-v2-dev-validation-branch");
  expect(result.recorded?.keys).toContain("CMUX_AUTH_SERVICE_KEY");
  expect(result.recorded?.keys).toContain("DATABASE_URL");
  expect(result.recorded?.keys.some(key => key.startsWith("STACK_"))).toBe(false);
});

test("a missing owned account, upstream subdomain or wrong authority refuses before provider commands", async () => {
  for (const overrides of [
    { CMUX_FORK_CLOUDFLARE_ACCOUNT_ID: "" },
    { CMUX_IROH_V2_WORKERS_SUBDOMAIN: "debussy" },
    { CMUX_AUTH_ORIGIN: "https://cmux.com" },
    { CMUX_AUTH_ORIGIN: "https://cmux.w3dev.app" },
  ]) {
    const result = await probe(overrides);
    expect(result.exit).not.toBe(0);
    expect(result.recorded).toBeNull();
  }
});
