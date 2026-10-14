import { beforeEach, describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CmuxSignInMessages } from "../app/handler/cmux-sign-in";
import de from "../messages/de.json";
import ja from "../messages/ja.json";

const pendingAuthAction = new Promise<never>(() => {});
let requestHeaders = new Headers();
let suspendAuthAction = false;
let receivedSignIn: { mode: string; messages: CmuxSignInMessages; providers: string[] } | undefined;
let receivedAction: { action: string; messages: CmuxSignInMessages } | undefined;
let providers: Record<string, unknown> = {};

mock.module("../app/handler/cmux-sign-in", () => ({
  CmuxSignIn: (props: NonNullable<typeof receivedSignIn>) => {
    receivedSignIn = props;
    return React.createElement("div", { "data-cmux-sign-in": props.mode });
  },
  OwnedAuthAction: (props: NonNullable<typeof receivedAction>) => {
    receivedAction = props;
    if (suspendAuthAction) throw pendingAuthAction;
    return React.createElement("div", { "data-owned-auth-action": props.action });
  },
}));
mock.module("../services/auth/betterAuthOptions", () => ({ betterAuthOptions: () => ({ socialProviders: providers }) }));
mock.module("next/headers", () => ({ headers: async () => requestHeaders }));
mock.module("next/navigation", () => ({ notFound: () => { throw new Error("not-found"); } }));
mock.module("next/server", () => ({ connection: async () => {} }));
const { default: AuthHandlerPage } = await import("../app/handler/[...stack]/page");

beforeEach(() => {
  requestHeaders = new Headers();
  suspendAuthAction = false;
  receivedSignIn = undefined;
  receivedAction = undefined;
  providers = {};
});

describe("owned authentication handler page", () => {
  test("sign-in and sign-up render in the browser's preferred language", async () => {
    requestHeaders.set("accept-language", "de,en;q=0.8");
    for (const mode of ["sign-in", "sign-up"]) {
      const page = await AuthHandlerPage({ params: Promise.resolve({ stack: [mode] }) });
      expect(renderToStaticMarkup(page)).toContain(`data-cmux-sign-in="${mode}"`);
      expect(receivedSignIn?.mode).toBe(mode);
      expect(receivedSignIn?.messages).toEqual(de.cmuxSignIn);
    }
  });

  test("passes the configured social providers to owned sign-in on every host", async () => {
    requestHeaders.set("host", "coderouter.dev");
    providers = { github: {} };
    const page = await AuthHandlerPage({ params: Promise.resolve({ stack: ["sign-in"] }) });
    expect(renderToStaticMarkup(page)).toContain('data-cmux-sign-in="sign-in"');
    expect(receivedSignIn?.providers).toEqual(["github"]);
  });

  test.each(["sign-out", "forgot-password", "reset-password", "oauth-consent"])(
    "%s uses the owned action behind a localized loading state", async (action) => {
      requestHeaders.set("accept-language", "ja,en;q=0.8");
      const page = await AuthHandlerPage({ params: Promise.resolve({ stack: [action] }) });
      expect(renderToStaticMarkup(page)).toContain(`data-owned-auth-action="${action}"`);
      expect(receivedAction?.action).toBe(action);
      expect(receivedAction?.messages).toEqual(ja.cmuxSignIn);
      suspendAuthAction = true;
      const html = renderToStaticMarkup(page);
      expect(html).toContain('aria-busy="true"');
      expect(html).toContain(ja.cmuxSignIn.redirecting);
    },
  );

  test.each([[], ["sign-in", "extra"], ["cli-auth-confirm"], ["email-verification"], ["team-invitation"], ["future-handler"], ["magic-link-callback"], ["oauth-callback"]])(
    "refuses a retired or unrecognized handler path %j", async (...stack: string[]) => {
      await expect(AuthHandlerPage({ params: Promise.resolve({ stack }) })).rejects.toThrow("not-found");
      expect(receivedSignIn).toBeUndefined();
      expect(receivedAction).toBeUndefined();
    },
  );
});
