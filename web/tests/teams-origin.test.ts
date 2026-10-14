import { describe, expect, test } from "bun:test";
import {
  DEFAULT_TEAM_INVITE_ORIGIN,
  safeTeamLocale,
  teamInviteAcceptUrl,
  teamInviteLinkUrl,
  trustedTeamInviteOrigin,
} from "../services/teams/origin";

function request(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("trusted invite origin", () => {
  const spoofed = request("https://evil.example/api/teams/x/invitations", { host: "evil.example" });

  test("prefers CMUX_TEAM_INVITE_ORIGIN, then CMUX_APP_ORIGIN, as bare origins", () => {
    expect(trustedTeamInviteOrigin(spoofed, {
      CMUX_TEAM_INVITE_ORIGIN: "https://team.cmux.test/some/path",
      CMUX_APP_ORIGIN: "https://app.cmux.test",
      NODE_ENV: "development",
    })).toBe("https://team.cmux.test");
    expect(trustedTeamInviteOrigin(spoofed, { CMUX_APP_ORIGIN: "https://app.cmux.test", NODE_ENV: "development" }))
      .toBe("https://app.cmux.test");
  });

  test("never trusts the request host in production", () => {
    expect(trustedTeamInviteOrigin(spoofed, { NODE_ENV: "production" })).toBe(DEFAULT_TEAM_INVITE_ORIGIN);
    expect(trustedTeamInviteOrigin(spoofed, { VERCEL_ENV: "production", NODE_ENV: "development" })).toBe("https://cmux.w3dev.app");
  });

  test("rejects unusable configuration and upstream production destinations", () => {
    for (const value of ["javascript:alert(1)", "not a url", "https://cmux.com", "https://www.cmux.com", "https://cmux.w3dev.app.evil.example"]) {
      expect(() => trustedTeamInviteOrigin(spoofed, { CMUX_APP_ORIGIN: value, NODE_ENV: "production" })).toThrow();
    }
  });

  test("uses the request origin only in development", () => {
    expect(trustedTeamInviteOrigin(request("http://localhost:3801/api/teams"), { NODE_ENV: "development" }))
      .toBe("http://localhost:3801");
  });
});

describe("invite URLs", () => {
  const environment = { CMUX_APP_ORIGIN: "https://cmux.w3dev.app", NODE_ENV: "production" };

  test("allow-lists the locale so request data cannot change the host or path", () => {
    expect(safeTeamLocale("ja")).toBe("ja");
    for (const value of ["//evil.com", "..%2f", "en/../../x", "xx", "", null, undefined]) {
      expect(safeTeamLocale(value)).toBe("en");
    }
    const hostile = request("https://app.cmux.test/api/teams", {
      "x-next-intl-locale": "//evil.com",
      referer: "https://evil.com/..%2f/dashboard",
      cookie: "NEXT_LOCALE=//evil.com",
    });
    const url = new URL(teamInviteAcceptUrl(hostile, environment));
    expect(url.origin).toBe("https://cmux.w3dev.app");
    expect(url.pathname).toBe("/en/dashboard/team/accept");
  });

  test("uses the caller's supported locale", () => {
    const japanese = request("https://app.cmux.test/api/teams", { referer: "https://app.cmux.test/ja/dashboard/teams/x" });
    expect(teamInviteAcceptUrl(japanese, environment)).toBe("https://cmux.w3dev.app/ja/dashboard/team/accept");
  });

  test("builds the join URL on the trusted origin", () => {
    const token = "A".repeat(43);
    expect(teamInviteLinkUrl(request("https://evil.example/x"), token, environment)).toBe(`https://cmux.w3dev.app/en/join/${token}`);
  });
});
