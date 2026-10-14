import { afterEach, describe, expect, test } from "bun:test";
import vercel from "../vercel.json";

import { authorizeCronRequest } from "../services/cronAuth";

const originalCronSecret = process.env.CRON_SECRET;

afterEach(() => {
  if (originalCronSecret === undefined) {
    delete process.env.CRON_SECRET;
  } else {
    process.env.CRON_SECRET = originalCronSecret;
  }
});

function requestWithAuthorization(authorization?: string): Request {
  return new Request("https://cmux.test/api/cron/vm-reconcile", {
    headers: authorization === undefined ? {} : { authorization },
  });
}

describe("cron auth", () => {
  test("every configured live cron refuses a request without its secret", async () => {
    process.env.CRON_SECRET = "cron-secret";
    for (const cron of vercel.crons) {
      const route = await import(`../app${cron.path}/route.ts`);
      const response = await route.GET(new Request(`https://cmux.w3dev.app${cron.path}`));
      expect(response.status).toBe(401);
    }
  });

  test("fails closed when CRON_SECRET is not configured, whatever the header says", () => {
    delete process.env.CRON_SECRET;

    for (const authorization of [undefined, "Bearer whatever", "Bearer cron-secret"]) {
      const result = authorizeCronRequest(requestWithAuthorization(authorization));
      expect(result).toEqual({ ok: false, reason: "cron_secret_missing" });
    }
  });

  test("rejects a request with no authorization header", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(authorizeCronRequest(requestWithAuthorization())).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  test("rejects a non-bearer authorization header", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(
      authorizeCronRequest(requestWithAuthorization("Basic cron-secret")),
    ).toEqual({ ok: false, reason: "unauthorized" });
  });

  test("rejects an empty bearer token", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(authorizeCronRequest(requestWithAuthorization("Bearer "))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  test("rejects a wrong bearer token of the same length", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(
      authorizeCronRequest(requestWithAuthorization("Bearer crons-ecret")),
    ).toEqual({ ok: false, reason: "unauthorized" });
  });

  test("rejects a wrong bearer token of a different length", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(
      authorizeCronRequest(requestWithAuthorization("Bearer wrong-secret")),
    ).toEqual({ ok: false, reason: "unauthorized" });
  });

  test("rejects a prefix of the configured secret", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(authorizeCronRequest(requestWithAuthorization("Bearer cron"))).toEqual({
      ok: false,
      reason: "unauthorized",
    });
  });

  test("accepts the configured bearer token", () => {
    process.env.CRON_SECRET = "cron-secret";

    expect(
      authorizeCronRequest(requestWithAuthorization("Bearer cron-secret")),
    ).toEqual({ ok: true });
  });

  test("trims bearer whitespace and a whitespace-padded secret", () => {
    process.env.CRON_SECRET = "  cron-secret  ";

    expect(
      authorizeCronRequest(requestWithAuthorization("Bearer cron-secret")),
    ).toEqual({ ok: true });
  });
});
