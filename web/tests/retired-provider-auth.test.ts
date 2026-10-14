import { describe, expect, test } from "bun:test";
import { GET as retiredWebhook } from "../app/api/webhooks/stack/route";
import { GET as retiredCron } from "../app/api/cron/hexclave-inbox/route";
import { POST as retiredBrowserHandoff } from "../app/handler/app-session-handoff/route";
import { GET as retiredCliPoll } from "../app/api/vault/cli/auth/poll/route";
import { createHexclaveServerApi } from "../services/auth/hexclave/serverApi";
import { stackApiBaseURL, stackTokenIssuerBaseURL } from "../services/auth/stackApiBaseURL";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runChild } from "./helpers/run-child";

describe("retired provider authentication boundaries", () => {
  const operators = [
    "coderouter/verify-vm-scope.ts", "stripe/backfill-pro-testflight-legacy-ownership.ts",
    "cloud-vm/smoke-vm-api.mjs", "cloud-vm/stress-vm-api.mjs",
    "cloud-vm/dogfood-journey.mjs", "cloud-vm/bench-vm-startup.mjs",
  ];
  for (const entrypoint of operators) {
    test(`${entrypoint} retires before SDK imports, credential reads or target configuration`, async () => {
      const path = fileURLToPath(new URL(`../scripts/${entrypoint}`, import.meta.url));
      const probe = `
        const credentials = new Set(["STACK_SECRET_SERVER_KEY", "NEXT_PUBLIC_STACK_PROJECT_ID", "NEXT_PUBLIC_STACK_PUBLISHABLE_CLIENT_KEY", "DATABASE_URL", "FREESTYLE_API_KEY"]);
        Object.defineProperty(process, "env", { value: new Proxy(process.env, {
          get(target, key) {
            if (credentials.has(key)) throw new Error("legacy_operator_secret_read");
            return Reflect.get(target, key);
          }
        }) });
        Bun.plugin({ name: "legacy-operator-boundary", setup(build) {
          build.onResolve({ filter: /^@hexclave\\/|(?:^|\\/)projects\\.mjs$/ }, () => { throw new Error("legacy_operator_dependency_loaded"); });
          build.onLoad({ filter: /node_modules\\/@hexclave\\// }, () => { throw new Error("legacy_operator_dependency_loaded"); });
        } });
        globalThis.fetch = async () => { throw new Error("legacy_operator_provider_contacted"); };
        process.argv = [process.execPath, ${JSON.stringify(path)}, "production", "--create", "--cmux-tui", "/must-not-execute"];
        try { await import(${JSON.stringify(pathToFileURL(path).href)}); }
        catch (error) { console.error(error.message); process.exitCode = 1; }
      `;
      const result = await runChild(process.execPath, ["--eval", probe], {
        timeout: 5_000,
        env: { NODE_ENV: "test", PATH: process.env.PATH, STACK_SECRET_SERVER_KEY: "must-not-be-read-or-printed" },
      });
      expect(result.error).toBeUndefined();
      expect(result.status).toBe(1);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("legacy_auth_operator_retired");
      expect(result.stderr).not.toMatch(/legacy_operator_(?:secret_read|dependency_loaded|provider_contacted)/u);
      expect(result.stderr).not.toContain("must-not-be-read-or-printed");
    });
  }

  const handlers = [
    ["upstream webhook", retiredWebhook], ["upstream inbox cron", retiredCron],
    ["raw-token browser handoff", retiredBrowserHandoff], ["upstream CLI login polling", retiredCliPoll],
  ] as const;
  for (const [name, handler] of handlers) {
    test(`${name} returns Gone without redirecting or installing cookies`, async () => {
      const response = await handler();
      expect(response.status).toBe(410);
      expect(await response.json()).toEqual({ error: "legacy_auth_flow_retired" });
      expect(response.headers.get("set-cookie")).toBeNull();
      expect(response.headers.get("location")).toBeNull();
    });
  }

  test("a stale upstream configuration cannot construct its retired server transport", () => {
    let contactedProvider = false;
    expect(() => createHexclaveServerApi({ projectId: "old-project", secretServerKey: "retired-key", baseURL: "https://api.hexclave.com",
      fetch: (async () => { contactedProvider = true; throw new Error("unexpected provider request"); }) as unknown as typeof fetch,
    })).toThrow("retired");
    expect(contactedProvider).toBe(false);
  });

  test("stale provider URL overrides cannot change the owned auth destination", () => {
    const previous = process.env.STACK_API_BASE_URL;
    const previousShared = process.env.HEXCLAVE_API_URL;
    try {
      process.env.STACK_API_BASE_URL = "https://api.stack-auth.com";
      process.env.HEXCLAVE_API_URL = "https://api.hexclave.com";
      expect(stackApiBaseURL()).toBe("https://cmux.w3dev.app");
      expect(stackTokenIssuerBaseURL()).toBe("https://cmux.w3dev.app");
    } finally {
      if (previous === undefined) delete process.env.STACK_API_BASE_URL; else process.env.STACK_API_BASE_URL = previous;
      if (previousShared === undefined) delete process.env.HEXCLAVE_API_URL; else process.env.HEXCLAVE_API_URL = previousShared;
    }
  });
});
