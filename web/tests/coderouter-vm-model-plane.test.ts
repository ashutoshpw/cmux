import { describe, expect, test } from "bun:test";
import {
  CODEROUTER_EDGE_ORIGIN_ENV,
  DEFAULT_CODEROUTER_EDGE_ORIGIN,
  VM_ROUTE_TOKEN_LABEL,
  VmModelPlaneUnavailableError,
  coderouterEdgeOrigin,
  provisionVmModelPlane,
  revokeVmModelPlane,
  vmModelPlaneEnabled,
  type VmModelPlaneDependencies,
} from "../services/coderouter/vmModelPlane";
import {
  VM_REFLECTION_ALIAS_HEADER,
  VM_REFLECTION_ALIAS_VALUE,
  vmGuestModelPlaneEnv,
} from "../services/coderouter/vmGuestEnv";
import {
  ROUTE_TOKEN_HEADER,
  VM_ID_HEADER,
  VM_AUTHORIZATION_HEADER,
  VM_PLACEHOLDER_API_KEY,
} from "../services/coderouter/routeTokenAuth";
import { freestyleEdgeRules } from "../services/vms/drivers/freestyle";
import { validateTlsSpec } from "freestyle";

// The Cloud VM model plane: a new machine gets base URLs and placeholder keys
// in its env, and edge rules that inject a route token bound to the VM row id:
// one for the coderouter alias, one for the reflection alias (same token, plus
// the marker the proxy routes on). The token never appears in the env; the edge injects both a bearer
// and the explicit route headers on the wire. Provisioning failures are
// typed so the workflow fails the create instead of shipping an unwired box.
// There is no plan or entitlement gate: every team gets a token.

const INPUT = { teamId: "team-1", stackUserId: "user-1", cloudVmId: "11111111-2222-4333-8444-555555555555" };

function deps(overrides: Partial<VmModelPlaneDependencies> = {}): VmModelPlaneDependencies {
  return {
    issueToken: async () => ({ token: "crt_test-token", expiresAt: new Date(0) }),
    revokeTokensForVm: async () => undefined,
    edgeOriginEnv: () => undefined,
    vercelEnv: () => "production",
    vercelBranchUrl: () => undefined,
    vercelBypassSecret: () => undefined,
    ...overrides,
  };
}

describe("provisionVmModelPlane", () => {
  test("mints a VM-bound token and returns the coderouter and reflection alias rules", async () => {
    const issued: unknown[] = [];
    const provision = await provisionVmModelPlane(
      INPUT,
      deps({
        issueToken: async (...args) => {
          issued.push(args);
          return { token: "crt_test-token", expiresAt: new Date(0) };
        },
      }),
    );
    expect(issued).toEqual([["team-1", "user-1", INPUT.cloudVmId]]);
    // The guest dials the alias; the edge forwards to this deployment's host.
    const headers = {
      authorization: "Bearer crt_test-token",
      [ROUTE_TOKEN_HEADER]: "crt_test-token",
      [VM_ID_HEADER]: INPUT.cloudVmId,
      [VM_AUTHORIZATION_HEADER]: "Bearer crt_test-token",
    };
    expect(provision.edgeRules).toEqual([
      { domain: "coderouter.cmux.internal", destinationHost: "cmux.w3dev.app", headers },
      // Reflection: the same identity, plus the marker the proxy routes on.
      {
        domain: "reflection.cmux.internal",
        destinationHost: "cmux.w3dev.app",
        headers: { ...headers, [VM_REFLECTION_ALIAS_HEADER]: VM_REFLECTION_ALIAS_VALUE },
      },
    ]);
  });

  test("nothing the guest sees carries a route token", async () => {
    const provision = await provisionVmModelPlane(INPUT, deps());
    expect(provision.edgeRules[0]?.domain).not.toMatch(/crt_|eyJ/);
    expect(JSON.stringify(vmGuestModelPlaneEnv())).not.toContain("crt_");
  });

  test("the provisioned rule is a valid Freestyle egress TLS spec", async () => {
    const provision = await provisionVmModelPlane(INPUT, deps());
    const rules = freestyleEdgeRules(provision.edgeRules);
    expect(rules).toHaveLength(2);
    expect(() => validateTlsSpec({ rules })).not.toThrow();
    for (const rule of rules ?? []) {
      expect(rule).toMatchObject({
        source: {},
        destination: { host: "cmux.w3dev.app", port: 443 },
        transform: [{ headers: { [VM_AUTHORIZATION_HEADER]: "Bearer crt_test-token" } }],
      });
    }
    expect(rules?.[1]?.transform[0]?.headers).toMatchObject({ [VM_REFLECTION_ALIAS_HEADER]: VM_REFLECTION_ALIAS_VALUE });
  });

  test("the origin override points the edge rule at a preview deployment", async () => {
    const provision = await provisionVmModelPlane(
      INPUT,
      deps({ edgeOriginEnv: () => "https://cmux-git-feat-manaflow.vercel.app/" }),
    );
    expect(provision.edgeRules.map((rule) => rule.domain)).toEqual(["coderouter.cmux.internal", "reflection.cmux.internal"]);
    expect(provision.edgeRules.every((rule) => rule.destinationHost === "cmux-git-feat-manaflow.vercel.app")).toBe(true);
  });

  test("outside production with no origin override, a machine gets no edge rule and no token", async () => {
    // A dev backend or local checkout signs with its own key and keeps its
    // database private; production can verify neither. Pointing its machines'
    // edge at production made every one poll cmux.w3dev.app with a refused
    // credential for the machine's whole life.
    for (const vercelEnv of [undefined, "development"]) {
      let issued = 0;
      const provision = await provisionVmModelPlane(INPUT, deps({
        vercelEnv: () => vercelEnv,
        issueToken: async () => {
          issued += 1;
          return { token: "crt_x", expiresAt: new Date(0) };
        },
      }));
      expect({ vercelEnv, rules: provision.edgeRules, issued }).toEqual({ vercelEnv, rules: [], issued: 0 });
    }
    // An explicit origin still wires a non-production machine.
    const wired = await provisionVmModelPlane(INPUT, deps({ vercelEnv: () => undefined, edgeOriginEnv: () => "https://coderouter-dev.example.com" }));
    expect(wired.edgeRules.map((rule) => rule.destinationHost)).toEqual(["coderouter-dev.example.com", "coderouter-dev.example.com"]);
  });

  test("an invalid or upstream origin refuses provisioning before issuing a token", async () => {
    for (const origin of [
      "http://edge.example", "https://coderouter.dev", "https://www.coderouter.dev", "https://CODEROUTER.DEV./",
      "https://cmux.com", "https://sr.cmux.com", "https://presence.cmux.dev",
      "https://machine.cmux.sh", "https://cmux.run",
    ]) {
      let issued = 0;
      await expect(provisionVmModelPlane(INPUT, deps({
        edgeOriginEnv: () => origin,
        issueToken: async () => { issued += 1; return { token: "crt_x", expiresAt: new Date(0) }; },
      }))).rejects.toBeInstanceOf(VmModelPlaneUnavailableError);
      expect(issued).toBe(0);
    }
  });

  test("a token issue infrastructure error is a typed unavailable failure", async () => {
    await expect(
      provisionVmModelPlane(
        INPUT,
        deps({
          issueToken: async () => {
            throw new Error("db down");
          },
        }),
      ),
    ).rejects.toBeInstanceOf(VmModelPlaneUnavailableError);
  });
});

describe("revokeVmModelPlane", () => {
  test("revokes every token bound to the VM row", async () => {
    const revoked: string[] = [];
    await revokeVmModelPlane(
      INPUT.cloudVmId,
      deps({
        revokeTokensForVm: async (vmId) => {
          revoked.push(vmId);
        },
      }),
    );
    expect(revoked).toEqual([INPUT.cloudVmId]);
  });
});

describe("coderouterEdgeOrigin", () => {
  test("defaults to the public host and accepts a bare https origin", () => {
    expect(coderouterEdgeOrigin(undefined)).toBe(DEFAULT_CODEROUTER_EDGE_ORIGIN);
    expect(coderouterEdgeOrigin("  ")).toBe(DEFAULT_CODEROUTER_EDGE_ORIGIN);
    expect(coderouterEdgeOrigin("https://cmux-git-x-manaflow.vercel.app")).toBe(
      "https://cmux-git-x-manaflow.vercel.app",
    );
    expect(coderouterEdgeOrigin("https://cmux-git-x-manaflow.vercel.app/")).toBe(
      "https://cmux-git-x-manaflow.vercel.app",
    );
  });

  test("rejects anything an edge rule cannot express", () => {
    for (const bad of [
      "http://cmux.w3dev.app",
      "https://cmux.w3dev.app:8443",
      "https://cmux.w3dev.app/v1",
      "https://cmux.w3dev.app/?x=1",
      "https://user:pw@cmux.w3dev.app",
      "cmux.w3dev.app",
    ]) {
      expect(() => coderouterEdgeOrigin(bad)).toThrow(CODEROUTER_EDGE_ORIGIN_ENV);
    }
  });
});

describe("vmModelPlaneEnabled", () => {
  test("defaults on, disables on false-flags only", () => {
    expect(vmModelPlaneEnabled(undefined)).toBe(true);
    expect(vmModelPlaneEnabled("1")).toBe(true);
    expect(vmModelPlaneEnabled("true")).toBe(true);
    for (const flag of ["0", "false", "no", "off", "disabled", " OFF "]) {
      expect(vmModelPlaneEnabled(flag)).toBe(false);
    }
  });
});

describe("preview deployments serve themselves as the edge origin", () => {
  test("a Vercel preview uses its branch URL and injects the bypass header", async () => {
    const provision = await provisionVmModelPlane(
      { teamId: "team-1", stackUserId: "user-1", cloudVmId: "11111111-2222-4333-8444-555555555555" },
      deps({
        vercelEnv: () => "preview",
        vercelBranchUrl: () => "cmux-git-feat-manaflow.vercel.app",
        vercelBypassSecret: () => "bypass-secret",
      }),
    );
    expect(provision.edgeRules[0]?.destinationHost).toBe("cmux-git-feat-manaflow.vercel.app");
    expect(provision.edgeRules[0]?.headers["x-vercel-protection-bypass"]).toBe("bypass-secret");
  });

  test("an explicit origin wins over the preview branch URL, and production adds no bypass header", async () => {
    const provision = await provisionVmModelPlane(
      { teamId: "team-1", stackUserId: "user-1", cloudVmId: "11111111-2222-4333-8444-555555555555" },
      deps({
        edgeOriginEnv: () => "https://cmux.w3dev.app",
        vercelEnv: () => "production",
        vercelBranchUrl: () => "cmux-git-main-manaflow.vercel.app",
        vercelBypassSecret: () => "bypass-secret",
      }),
    );
    expect(provision.edgeRules[0]?.destinationHost).toBe("cmux.w3dev.app");
    expect(provision.edgeRules[0]?.headers["x-vercel-protection-bypass"]).toBeUndefined();
  });
});
