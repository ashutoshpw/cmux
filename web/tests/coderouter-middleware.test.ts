import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import middleware from "../proxy";

describe("coderouter middleware", () => {
  test.each(["en", "ja"])("serves the OAuth handoff in %s without a locale rewrite or sign-in", (locale) => {
    const response = middleware(
      new NextRequest("https://cmux.w3dev.app/coderouter/auth/complete", {
        headers: { host: "cmux.w3dev.app", "accept-language": locale },
      }),
    );

    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
    expect(response.headers.get("x-middleware-request-x-next-intl-locale")).toBe(locale);
  });

  test("serves the same dedicated landing page on cmux.w3dev.app/coderouter", () => {
    const response = middleware(
      new NextRequest("https://cmux.w3dev.app/coderouter", {
        headers: { host: "cmux.w3dev.app" },
      }),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  test("the primary homepage stays the product homepage", () => {
    const response = middleware(new NextRequest("https://cmux.w3dev.app/", {
      headers: { host: "cmux.w3dev.app", "accept-language": "en" },
    }));
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://cmux.w3dev.app/en");
  });

  test("does not localize the OpenAI-compatible data-plane route", () => {
    const response = middleware(
      new NextRequest("https://cmux.w3dev.app/v1/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  test("does not localize Pi's Codex-compatible data-plane route", () => {
    const response = middleware(
      new NextRequest("https://cmux.w3dev.app/v1/codex/responses", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  test("forwards the localized dashboard destination to the server auth gate", () => {
    const response = middleware(
      new NextRequest(
        "https://cmux.w3dev.app/ja/dashboard/coderouter?team=team-1",
        {
          headers: {
            "x-cmux-dashboard-return-path": "/pricing",
            cookie: `stack-refresh-${process.env.NEXT_PUBLIC_STACK_PROJECT_ID ?? "test-project"}=refresh-token`,
          },
        },
      ),
    );

    expect(
      response.headers.get("x-middleware-request-x-cmux-dashboard-return-path"),
    ).toBe("/dashboard/coderouter?team=team-1");
  });

  test("keeps a dashboard POST body while adding the auth return path", async () => {
    const request = new NextRequest("https://cmux.w3dev.app/en/dashboard/testflight", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        cookie: `stack-refresh-${process.env.NEXT_PUBLIC_STACK_PROJECT_ID ?? "test-project"}=refresh-token`,
      },
      body: "action=join",
    });
    const response = middleware(request);

    expect(await request.text()).toBe("action=join");
    expect(
      response.headers.get("x-middleware-request-x-cmux-dashboard-return-path"),
    ).toBe("/dashboard/testflight");
  });
});
