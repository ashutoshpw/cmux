import { describe, expect, test } from "bun:test";
import { GET } from "../app/api/cli/config/route";

async function withOrigin(origin: string | undefined, run: () => Promise<void>) {
  const previous = process.env.CMUX_APP_ORIGIN;
  if (origin === undefined) delete process.env.CMUX_APP_ORIGIN;
  else process.env.CMUX_APP_ORIGIN = origin;
  try { await run(); } finally {
    if (previous === undefined) delete process.env.CMUX_APP_ORIGIN;
    else process.env.CMUX_APP_ORIGIN = previous;
  }
}

describe("owned CLI config route", () => {
  test("advertises the canonical OAuth issuer regardless of request host", async () => {
    await withOrigin("https://cmux.w3dev.app", async () => {
      const body = await GET(new Request("https://untrusted.example/api/cli/config")).json();
      expect(body.auth.issuer).toBe("https://cmux.w3dev.app/api/auth");
      expect(body.auth.resource).toBe("https://cmux.w3dev.app/api");
      expect(body.coderouter.sessionUrl).toBe("https://cmux.w3dev.app/api/coderouter/session");
    });
  });
  test("publishes OAuth/PKCE endpoints and owned CodeRouter routes with no legacy provider keys", async () => {
    await withOrigin("https://cmux.w3dev.app", async () => {
      const response = GET();
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      const body = await response.json();
      expect(body.version).toBe(5);
      expect(body.clientContract).toBe("better-auth-oauth-pkce-v1");
      expect(body.auth).toEqual({ provider: "better-auth", issuer: "https://cmux.w3dev.app/api/auth", resource: "https://cmux.w3dev.app/api", authorizationEndpoint: "https://cmux.w3dev.app/api/auth/oauth2/authorize", tokenEndpoint: "https://cmux.w3dev.app/api/auth/oauth2/token", scopes: ["openid", "profile", "email", "offline_access", "cmux:api"], deviceAuthorizationAvailable: false });
      expect(body.coderouter.accountsUrl).toBe("https://cmux.w3dev.app/api/coderouter/accounts");
      expect(body).not.toHaveProperty("subrouter");
      expect(body.auth).not.toHaveProperty("publishableClientKey");
      expect(body.auth).not.toHaveProperty("confirmUrl");
    });
  });
  test("older CLI builds receive the explicit new contract without a legacy login-code fallback", async () => {
    const body = await GET(new Request("https://untrusted.example/api/cli/config?clientVersion=0.2.2")).json();
    expect(body.clientContract).toBe("better-auth-oauth-pkce-v1");
    expect(body.auth.deviceAuthorizationAvailable).toBe(false);
    expect(body.auth).not.toHaveProperty("confirmUrl");
  });
  test("an explicitly configured local issuer keeps every endpoint local", async () => {
    await withOrigin("http://127.0.0.1:4152", async () => {
      const body = await GET().json();
      expect(body.auth.issuer).toBe("http://127.0.0.1:4152/api/auth");
      expect(body.coderouter.openaiBaseUrl).toBe("http://127.0.0.1:4152/v1");
    });
  });
  test("an explicitly configured staging issuer keeps every endpoint on staging", async () => {
    await withOrigin("https://staging.cmux.w3dev.app", async () => {
      const body = await GET(new Request("https://cmux.w3dev.app/api/cli/config")).json();
      expect(body.auth.issuer).toBe("https://staging.cmux.w3dev.app/api/auth");
      expect(body.coderouter.sessionUrl).toBe("https://staging.cmux.w3dev.app/api/coderouter/session");
    });
  });
  test("refuses to advertise an upstream provider as the owned issuer", async () => {
    await withOrigin("https://cmux.com", async () => {
      expect(() => GET()).toThrow("Upstream application origins are not available");
    });
  });
});
