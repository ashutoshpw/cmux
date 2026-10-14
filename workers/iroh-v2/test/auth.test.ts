import { expect, test } from "bun:test";
import { StackAuthority } from "../src/auth";
import { descriptor } from "./fixtures";
const origin = "https://cmux.w3dev.app";
const identity = { ...descriptor.identity, projectId: origin };
const configuration = { environment: identity.environment, projectId: origin, apiURL: origin, serverKey: "test-owned-service-key" };
const principal = { user: { id: identity.userId }, session: { id: "auth-session" }, organizations: [{ id: identity.teamId, role: "owner" }] };
test("owned bearer establishes only the current explicit organization authority", async () => {
  const authority = new StackAuthority(configuration, async (url, init) => {
    expect(new URL(url).origin).toBe(origin); expect(new URL(url).pathname).toBe("/api/native-auth/session");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-token"); return Response.json(principal);
  });
  expect(await authority.verify("test-token", identity, 100)).toEqual({ ...identity, sessionId: "auth-session", verifiedAt: 100 });
  await expect(authority.verify("test-token", { ...identity, teamId: identity.userId }, 100)).rejects.toMatchObject({ code: "team_access_revoked" });
  await expect(authority.verify("test-token", { ...identity, userId: "different" }, 100)).rejects.toMatchObject({ code: "identity_mismatch" });
  await expect(authority.verify("test-token", { ...identity, environment: "other" }, 100)).rejects.toMatchObject({ code: "environment_mismatch" });
});
test("provider unavailability is recoverable and an explicitly rejected bearer is unauthorized", async () => {
  const unavailable = new StackAuthority(configuration, async () => new Response(null, { status: 503 }));
  await expect(unavailable.verify("token", identity, 100)).rejects.toMatchObject({ code: "upstream_unavailable", retryable: true });
  const rejected = new StackAuthority(configuration, async () => new Response(null, { status: 401 }));
  await expect(rejected.verify("token", identity, 100)).rejects.toMatchObject({ code: "unauthorized" });
});
test("ticket management binds its current session and actor organization to the internal authority request", async () => {
  const authority = new StackAuthority(configuration, async (url, init) => {
    expect(new URL(url).pathname).toBe("/api/internal/auth-authority");
    expect(new Headers(init.headers).get("authorization")).toBe(`Bearer ${configuration.serverKey}`);
    expect(JSON.parse(String(init.body))).toEqual({ actorUserId: identity.userId, sessionId: "auth-session", organizationId: identity.teamId, userId: identity.userId, action: "manage" });
    return Response.json({ allowed: false });
  });
  expect(await authority.canManageTeam({ environment: identity.environment, projectId: origin, teamId: identity.teamId, userId: identity.userId, sessionId: "auth-session", verifiedAt: 100 })).toBe(false);
});
test("authority work is bounded and unowned authentication origins are rejected", async () => {
  expect(() => new StackAuthority({ ...configuration, apiURL: "https://api.stack-auth.com" })).toThrow("Owned authentication origin");
  let release!: () => void; const pending = new Promise<void>((resolve) => { release = resolve; });
  const authority = new StackAuthority(configuration, async () => { await pending; return Response.json(principal); }, 1);
  const first = authority.verify("token", identity, 100);
  await expect(authority.verify("token2", identity, 100)).rejects.toMatchObject({ code: "upstream_unavailable" });
  release(); await first;
});
