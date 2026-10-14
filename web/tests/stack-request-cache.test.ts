import { ownedPrincipal } from "./helpers/owned-principal";
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, mock, test } from "bun:test";

// Use the same React Server Components build that Next uses. Bun's default
// React condition makes cache() a no-op and would give false test confidence.
const reactServer = await import(
  // @ts-expect-error Next's internal React Server Components build has no public types.
  "next/dist/compiled/react-experimental/react.react-server.js",
);
mock.module("react", () => reactServer);
const React = await import("react");
const { renderToReadableStream } = await import(
  // @ts-expect-error Next's internal React Server Components renderer has no public types.
  "next/dist/compiled/react-server-dom-turbopack/server.node",
);

const requestIdentity = new AsyncLocalStorage<{ readonly id: string }>();
const resolvePrincipal = mock(async (headers: Headers) => ownedPrincipal({
  id: requestIdentity.getStore()?.id ?? "missing-request-context",
}, headers));
mock.module("next/headers", () => ({ headers: async () => new Headers() }));
mock.module("next/navigation", () => ({ redirect: () => { throw new Error("unexpected redirect"); } }));
mock.module("../services/auth/betterAuthPrincipal", () => ({
  resolveBetterAuthPrincipal: resolvePrincipal,
  getBetterAuthBrowserAccessToken: async () => null,
  revokeBetterAuthSession: () => { throw new Error("unexpected session revocation"); },
}));
mock.module("../services/auth/betterAuthServer", () => ({ getBetterAuth: () => ({}) }));
mock.module("../db/client", () => ({ cloudDb: () => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [{
    id: requestIdentity.getStore()?.id ?? "missing-request-context", name: "User", email: "user@example.com",
    emailVerified: true, isAnonymous: false, selectedTeamId: null, createdAt: new Date(0),
    clientMetadata: {}, clientReadOnlyMetadata: {}, serverMetadata: {},
  }] }) }) }),
}) }));
mock.module("../services/account/metadataMutation", () => ({
  withFreshAccountMetadataUser: async () => undefined,
}));
mock.module("../services/billing/emailMatching", () => ({
  canonicalizeEmailForMatching: (email: string) => email,
}));
mock.module("../services/auth/stackTelemetry", () => ({
  withStackAuthSpan: async <T>(
    _operation: string,
    fn: (span: unknown) => Promise<T>,
  ) => fn({ setAttribute: () => undefined }),
}));

const { getRequestScopedStackUser } = await import("../app/lib/stack");

async function renderForIdentity(id: string): Promise<string> {
  return requestIdentity.run({ id }, async () => {
    async function Probe() {
      const first = getRequestScopedStackUser("dashboard");
      const second = getRequestScopedStackUser("admin_page");
      const [firstUser, secondUser] = await Promise.all([first, second]);
      return React.createElement("p", null, `${firstUser?.id}:${secondUser?.id}`);
    }

    const stream = await renderToReadableStream(React.createElement(Probe), {});
    return new Response(stream).text();
  });
}

describe("request-scoped owned user cache", () => {
  test("deduplicates one render without sharing identity across concurrent renders", async () => {
    resolvePrincipal.mockClear();

    const [alice, bob] = await Promise.all([
      renderForIdentity("alice"),
      renderForIdentity("bob"),
    ]);

    expect(alice).toContain("alice:alice");
    expect(bob).toContain("bob:bob");
    expect(resolvePrincipal).toHaveBeenCalledTimes(2);
  });
});
