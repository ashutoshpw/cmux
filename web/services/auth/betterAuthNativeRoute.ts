import { Effect, Exit } from "effect";
import { applicationOrigin } from "../deployment/origin";
import { BetterAuthForbidden, BetterAuthUnavailable } from "./betterAuthPrincipal";

/** Cookies require the canonical Origin for mutations; OAuth bearer requests do not use cookies. */
export function nativeAuthMutationAllowed(request: Request): boolean {
  if (request.headers.has("authorization")) return true;
  return request.headers.get("origin") === applicationOrigin();
}

export async function runBetterAuthNativeRoute<A>(program: Effect.Effect<A, BetterAuthForbidden | BetterAuthUnavailable>, serialize: (value: A) => Response): Promise<Response> {
  const result = await Effect.runPromiseExit(program);
  if (Exit.isSuccess(result)) return serialize(result.value);
  const failure = result.cause;
  if (failure._tag === "Fail") {
    const status = failure.error instanceof BetterAuthForbidden ? 403 : 503;
    return Response.json({ error: failure.error.message }, { status, headers: { "Cache-Control": "no-store" } });
  }
  console.error("Native authentication request failed unexpectedly");
  return Response.json({ error: "Authentication service unavailable" }, { status: 500 });
}
