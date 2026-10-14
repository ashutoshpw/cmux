import { describe, expect, test } from "bun:test";
import { locales } from "../i18n/routing";
import { betterAuthMailTemplate } from "../services/auth/betterAuthMailTemplate";

const url = "https://cmux.w3dev.app/api/auth/verify-email?token=example";
const request = (language: string) => new Request("https://cmux.w3dev.app/api/auth", { headers: { "Accept-Language": language } });

describe("authentication email templates", () => {
  test("uses the requested Japanese language and preserves the verification link", async () => {
    const mail = await betterAuthMailTemplate("verify", { url }, request("ja,en;q=0.8"));
    expect(mail.subject).toBe("cmux のメールアドレスを確認");
    expect(mail.text).toContain(url);
  });
  test("respects language quality and falls back to English for unsupported locales", async () => {
    expect((await betterAuthMailTemplate("reset", { url }, request("de;q=0.2,ja;q=1"))).subject).toBe("cmux のパスワードをリセット");
    expect((await betterAuthMailTemplate("reset", { url }, request("eo"))).subject).toBe("Reset your cmux password");
  });
  test("sanitizes invitation header display text", async () => {
    const mail = await betterAuthMailTemplate("invite", { url, organization: "Team\r\nInjected" }, request("en"));
    expect(mail.subject).toBe("Join Team  Injected on cmux");
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
  test("all supported email catalogs interpolate the code and links without missing keys", async () => {
    for (const locale of locales) {
      expect((await betterAuthMailTemplate("otp", { otp: "284917" }, request(locale))).text).toContain("284917");
      expect((await betterAuthMailTemplate("reset", { url }, request(locale))).text).toContain(url);
      expect((await betterAuthMailTemplate("magic", { url }, request(locale))).text).toContain(url);
      expect((await betterAuthMailTemplate("invite", { url, organization: "Example" }, request(locale))).subject).toContain("Example");
    }
  });
});
