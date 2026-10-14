import { describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import middleware from "../proxy";
import {
  VM_REFLECTION_ALIAS_HEADER,
  VM_REFLECTION_ALIAS_VALUE,
} from "../services/coderouter/vmGuestEnv";

// A cmux Cloud machine dialing `https://reflection.cmux.internal/<path>` reaches
// this deployment through the platform edge, which adds the alias marker header
// next to the machine's credential. The proxy serves the guest-facing reflection
// API for such requests and leaves everything else alone.

describe("reflection alias proxy", () => {
  test("rewrites the alias root to the reflection index (no trailing slash)", () => {
    const response = middleware(
      new NextRequest("https://cmux.w3dev.app/", {
        headers: { host: "cmux.w3dev.app", [VM_REFLECTION_ALIAS_HEADER]: VM_REFLECTION_ALIAS_VALUE },
      }),
    );
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://cmux.w3dev.app/api/vm/reflection");
  });

  test("rewrites alias sub-paths and strips trailing slashes", () => {
    const peers = middleware(
      new NextRequest("https://cmux.w3dev.app/peers/", {
        headers: { host: "cmux.w3dev.app", [VM_REFLECTION_ALIAS_HEADER]: VM_REFLECTION_ALIAS_VALUE },
      }),
    );
    expect(peers.headers.get("x-middleware-rewrite")).toBe("https://cmux.w3dev.app/api/vm/reflection/peers");
    const integrations = middleware(
      new NextRequest("https://cmux.w3dev.app/integrations?x=1", {
        headers: { host: "cmux.w3dev.app", [VM_REFLECTION_ALIAS_HEADER]: VM_REFLECTION_ALIAS_VALUE },
      }),
    );
    expect(integrations.headers.get("x-middleware-rewrite")).toBe("https://cmux.w3dev.app/api/vm/reflection/integrations?x=1");
  });

  test("a wrong marker value or no marker never reaches reflection", () => {
    const wrong = middleware(
      new NextRequest("https://cmux.w3dev.app/peers", {
        headers: { host: "cmux.w3dev.app", [VM_REFLECTION_ALIAS_HEADER]: "something-else" },
      }),
    );
    expect(wrong.headers.get("x-middleware-rewrite") ?? "").not.toContain("/api/vm/reflection");
    const plain = middleware(
      new NextRequest("https://cmux.w3dev.app/", { headers: { host: "cmux.w3dev.app" } }),
    );
    expect(plain.headers.get("x-middleware-rewrite")).toBe("https://cmux.w3dev.app/en");
  });
});
