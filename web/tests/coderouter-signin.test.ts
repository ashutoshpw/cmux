import { describe, expect, mock, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { CmuxSignInMessages } from "../app/handler/cmux-sign-in";
import { loadMessages } from "../i18n/messages";

mock.module("next/navigation", () => ({ useSearchParams: () => new URLSearchParams() }));
mock.module("../app/lib/stack-client", () => ({ authClient: {} }));
const { CmuxSignIn } = await import("../app/handler/cmux-sign-in");

describe("owned sign-in privacy", () => {
  test("offers email and passkey authentication with no unconfigured social connector", async () => {
    const messages = (await loadMessages("en")).cmuxSignIn as CmuxSignInMessages;
    const html = renderToStaticMarkup(React.createElement(CmuxSignIn, { mode: "sign-in", messages, providers: [] }));
    expect(html).toContain('type="email"');
    expect(html).toContain(messages.signInWithPasskey);
    expect(html).toContain(messages.continueWithEmail);
    expect(html).not.toContain("Google");
    expect(html).not.toContain("GitHub");
    expect(html).not.toContain("Gmail");
  });

  test("shows only the social providers the owned deployment enables", async () => {
    const messages = (await loadMessages("en")).cmuxSignIn as CmuxSignInMessages;
    const html = renderToStaticMarkup(React.createElement(CmuxSignIn, { mode: "sign-in", messages, providers: ["github"] }));
    expect(html).toContain("GitHub");
    expect(html).not.toContain("Google");
    expect(html).not.toContain("Gmail");
  });
});
