import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { makeAfterSignInHandler } from "../app/handler/after-sign-in/handler";
const origin = "https://cmux.w3dev.app";
describe("owned browser auth completion", () => {
  test("redirects only to owned relative paths and never transfers reusable credentials", async () => {
    const sideEffects: string[] = [];
    const GET = makeAfterSignInHandler({ getUser: async () => ({ id: "verified", primaryEmail: "user@example.test", primaryEmailVerified: true, isAnonymous: false }), claimVerifiedBilling: async (id) => { sideEffects.push(id); }, applyAdminGrants: async (_id, email) => { sideEffects.push(email); } });
    for (const destination of ["https://cmux.com/dashboard", "//evil.test/callback", "cmux-w3dev://auth-callback", "/\\evil.test/callback"]) {
      const request = new NextRequest(`${origin}/handler/after-sign-in?after_auth_return_to=${encodeURIComponent(destination)}&access_token=secret&refresh_token=secret`);
      const response = await GET(request);
      expect(response.headers.get("location")).toBe(`${origin}/dashboard`);
      expect(response.headers.get("set-cookie")).toBeNull();
    }
    expect(sideEffects).toHaveLength(8);
    const response = await GET(new NextRequest(`${origin}/handler/after-sign-in?after_auth_return_to=%2Fdashboard%2Fbilling`));
    expect(response.headers.get("location")).toBe(`${origin}/dashboard/billing`);
  });
  test("billing ownership grants require a verified non-anonymous mailbox", async () => {
    let calls = 0;
    const GET = makeAfterSignInHandler({ getUser: async () => ({ id: "unverified", primaryEmail: "user@example.test", primaryEmailVerified: false, isAnonymous: false }), claimVerifiedBilling: async () => { calls++; }, applyAdminGrants: async () => { calls++; } });
    await GET(new NextRequest(`${origin}/handler/after-sign-in`));
    expect(calls).toBe(0);
  });
  test("signed-out completion returns to sign-in without running billing writes", async () => {
    let calls = 0;
    const GET = makeAfterSignInHandler({ getUser: async () => null, claimVerifiedBilling: async () => { calls++; }, applyAdminGrants: async () => { calls++; } });
    const response = await GET(new NextRequest(`${origin}/handler/after-sign-in`));
    expect(response.headers.get("location")).toBe(`${origin}/handler/sign-in`);
    expect(calls).toBe(0);
  });
});
