import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import en from "../messages/en.json";
import ja from "../messages/ja.json";
import { CliAuthConfirmation } from "../app/handler/cli-auth-confirmation";

describe("retired upstream CLI authorization", () => {
  for (const [locale, messages] of [["en", en], ["ja", ja]] as const) {
    test(`${locale} screen explains sign-in without offering a retired authorization action`, () => {
      const html = renderToStaticMarkup(<CliAuthConfirmation identityMessages={messages.cliAuthIdentity} />);
      expect(html).toContain(messages.cliAuthIdentity.signedOutBody);
      expect(html).not.toContain("<button");
      expect(html).not.toContain("login_code");
    });
  }
});
