import { revokeBetterAuthSession } from "../../../../services/auth/betterAuthPrincipal";
import { nativeAuthMutationAllowed, runBetterAuthNativeRoute } from "../../../../services/auth/betterAuthNativeRoute";

export function POST(request: Request) {
  if (!nativeAuthMutationAllowed(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  return runBetterAuthNativeRoute(revokeBetterAuthSession(request.headers), () => Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } }));
}
