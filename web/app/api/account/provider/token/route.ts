import { getBetterAuthBrowserAccessToken } from "../../../../../services/auth/betterAuthPrincipal";
import { nativeAuthMutationAllowed } from "../../../../../services/auth/betterAuthNativeRoute";
export async function POST(request: Request): Promise<Response> {
  if (!nativeAuthMutationAllowed(request))
    return Response.json({ error: "forbidden" }, { status: 403 });
  const accessToken = await getBetterAuthBrowserAccessToken(request.headers);
  return accessToken
    ? Response.json(
        { accessToken, refreshToken: null },
        { headers: { "cache-control": "no-store" } },
      )
    : Response.json({ error: "unauthorized" }, { status: 401 });
}
