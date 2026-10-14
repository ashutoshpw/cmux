import { describe, expect, test } from "bun:test";

import { ADMIN_EMAIL_DOMAINS, isAdminEmail, isAdminUser } from "../services/admin/access";

describe("admin access", () => {
  test("admin domains are the explicitly configured fork domains", () => {
    expect([...ADMIN_EMAIL_DOMAINS]).toEqual(["w3dev.app"]);
  });

  test("isAdminEmail accepts addresses on every admin domain, any case", () => {
    expect(isAdminEmail("admin@w3dev.app")).toBe(true);
    expect(isAdminEmail("austin@w3dev.app")).toBe(true);
    expect(isAdminEmail("hello@w3dev.app")).toBe(true);
    expect(isAdminEmail("  Austin@W3DEV.APP ")).toBe(true);
    expect(isAdminEmail("Some.One+tag@W3Dev.App")).toBe(true);
  });

  test("isAdminEmail rejects other domains, subdomains, and lookalikes", () => {
    for (const email of [
      "someone@example.com",
      "someone@gmail.com",
      "someone@sub.w3dev.app",
      "someone@sub.w3dev.app",
      "someone@w3dev.app.evil.com",
      "someone@w3dev.app.evil.com",
      "someone@notw3dev.app",
      "someone@xw3dev.app",
      "someone@w3dev.app.",
      "someone@manaflow.io",
      "someone@manaflow.co",
      "someone@cmux.co",
      "someone@cmux.dev",
      "someone@manaflow.a",
      "someone@w3dev.app​", // zero-width space
      "someone@manaflow.aі", // Cyrillic i
      "someone@мanaflow.ai", // Cyrillic m
      "someone@xn--manaflow-abc.ai",
      "someone@w3dev.app evil.com",
      "someone@w3dev.app,evil.com",
      "someone@w3dev.app/evil.com",
      "someone@w3dev.app:evil.com",
      "someone@[w3dev.app]",
      "someone@manaflow_ai",
    ]) {
      expect(isAdminEmail(email)).toBe(false);
    }
  });

  test("isAdminEmail rejects malformed or ambiguous addresses", () => {
    for (const email of [
      "w3dev.app",
      "@w3dev.app",
      "a@",
      "",
      "   ",
      "a@evil.com@w3dev.app",
      '"a@evil.com"@w3dev.app',
      "a\\@evil.com@w3dev.app",
      "a b@w3dev.app",
      "a\tb@w3dev.app",
      "a,b@w3dev.app",
      "a(b)@w3dev.app",
      "a<b>@w3dev.app",
      `${"a".repeat(65)}@w3dev.app`,
      "a\nb@w3dev.app",
      `${"a".repeat(250)}@w3dev.app`,
    ]) {
      expect(isAdminEmail(email)).toBe(false);
    }
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });

  test("isAdminUser requires a verified, explicitly non-anonymous admin email", () => {
    const admin = { primaryEmail: "admin@w3dev.app", primaryEmailVerified: true, isAnonymous: false };
    expect(isAdminUser(admin)).toBe(true);
    expect(isAdminUser({ ...admin, primaryEmail: "hello@w3dev.app" })).toBe(true);
    expect(isAdminUser({ ...admin, primaryEmail: "hello@w3dev.app" })).toBe(true);

    expect(isAdminUser({ ...admin, primaryEmailVerified: false })).toBe(false);
    expect(isAdminUser({ ...admin, primaryEmailVerified: undefined })).toBe(false);
    expect(isAdminUser({ ...admin, isAnonymous: true })).toBe(false);
    expect(isAdminUser({ ...admin, isAnonymous: undefined })).toBe(false);
    expect(isAdminUser({ ...admin, primaryEmail: "person@example.com" })).toBe(false);
    expect(isAdminUser({ ...admin, primaryEmail: null })).toBe(false);
    expect(isAdminUser({ ...admin, primaryEmail: undefined })).toBe(false);
    expect(isAdminUser({ primaryEmail: "admin@w3dev.app" })).toBe(false);
    expect(isAdminUser(null)).toBe(false);
    expect(isAdminUser(undefined)).toBe(false);
  });
});
