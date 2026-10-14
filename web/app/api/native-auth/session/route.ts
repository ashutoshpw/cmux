import { resolveBetterAuthPrincipalEffect } from "../../../../services/auth/betterAuthPrincipal";
import { runBetterAuthNativeRoute } from "../../../../services/auth/betterAuthNativeRoute";

export function GET(request: Request) {
  return runBetterAuthNativeRoute(resolveBetterAuthPrincipalEffect(request.headers), principal => {
    if (!principal || !principal.emailVerified || principal.isAnonymous) return Response.json({ error: "Authentication is required" }, { status: 401 });
    return Response.json({ user: { id: principal.userId, name: principal.displayName, email: principal.email,
      image: principal.image, emailVerified: principal.emailVerified, clientReadOnlyMetadata: principal.clientReadOnlyMetadata },
      organizations: principal.organizations.map(({ id, name, slug, role }) => ({ id, name, slug, role })),
      activeOrganizationId: principal.activeOrganizationId, session: { id: principal.sessionId } },
    { headers: { "Cache-Control": "no-store" } });
  });
}
