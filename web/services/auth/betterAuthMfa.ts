import { createAuthMiddleware, getOAuthState } from "better-auth/api";
import { twoFactor } from "better-auth/plugins";

const browserSignIn = (path: string | undefined) => path === "/magic-link/verify" || path?.startsWith("/callback/") === true;

function pendingSecondFactor(response: unknown): boolean {
  return response !== null && typeof response === "object" && "twoFactorRedirect" in response && response.twoFactorRedirect === true;
}

/** Better Auth 1.7.7 only matches password login; every enabled first factor needs the same challenge. */
export function betterAuthMfa(origin: string) {
  const plugin = twoFactor({ issuer: "cmux W3Dev", allowPasswordless: true, schema: { twoFactor: { modelName: "auth_two_factor" } } });
  const challenge = plugin.hooks.after[0]!;
  const originalMatcher = challenge.matcher;
  challenge.matcher = context => originalMatcher(context) || context.path?.startsWith("/sign-in/") === true
    || browserSignIn(context.path) || context.path === "/passkey/verify-authentication"
    || context.path === "/email-otp/verify-email" || context.path === "/verify-email";
  // Reuse the provider handler, including provisional-session deletion, signed
  // challenges, attempt budgets and remembered-device checks, before OAuth hooks.
  plugin.hooks.after.push({
    matcher: context => browserSignIn(context.path) && pendingSecondFactor(context.context.returned),
    handler: createAuthMiddleware(async context => {
      const previous = context.context.responseHeaders?.get("location") ?? "/handler/after-sign-in";
      const callback = new URL(previous, origin);
      let returnTo = callback.origin === origin ? `${callback.pathname}${callback.search}${callback.hash}` : "/handler/after-sign-in";
      const state = await getOAuthState();
      const query = state?.serverContext?.query;
      if (typeof query === "string" && query) returnTo = `/api/auth/oauth2/authorize?${query}`;
      const redirect = new URL("/handler/sign-in", origin);
      redirect.searchParams.set("mfa", "required");
      redirect.searchParams.set("after_auth_return_to", returnTo);
      throw context.redirect(redirect.toString());
    }),
  });
  return plugin;
}
