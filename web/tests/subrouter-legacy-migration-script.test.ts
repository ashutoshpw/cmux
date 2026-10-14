import { expect, test } from "bun:test";
import { runChild } from "./helpers/run-child";
import { fileURLToPath } from "node:url";
/** An operator must never migrate this fresh fork through an upstream auth provider. */
test("the retired upstream tenant migration fails before reading legacy account configuration", async () => {
  const path = fileURLToPath(new URL("../scripts/subrouter/migrate-legacy-tenants.ts", import.meta.url));
  const result = await runChild(process.execPath, [path, "--dry-run"], { env: { NODE_ENV: "test", PATH: process.env.PATH, STACK_SECRET_SERVER_KEY: "must-not-be-printed" } });
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("Legacy upstream tenant migration is retired");
  expect(result.stdout).toBe("");
  expect(result.stderr).not.toContain("must-not-be-printed");
});
