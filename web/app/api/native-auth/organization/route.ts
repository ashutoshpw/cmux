import { z } from "zod";
import { updateBetterAuthOrganization } from "../../../../services/auth/betterAuthPrincipal";
import { nativeAuthMutationAllowed, runBetterAuthNativeRoute } from "../../../../services/auth/betterAuthNativeRoute";

export async function POST(request: Request) {
  if (!nativeAuthMutationAllowed(request)) return Response.json({ error: "Invalid origin" }, { status: 403 });
  const input = z.object({ organizationId: z.uuid().nullable() }).strict().safeParse(await request.json().catch(() => null));
  if (!input.success) return Response.json({ error: "organizationId must be a UUID or null" }, { status: 400 });
  return runBetterAuthNativeRoute(updateBetterAuthOrganization(request.headers, input.data.organizationId), () => Response.json({ ok: true }));
}
