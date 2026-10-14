import type { BetterAuthPrincipal } from "../../services/auth/betterAuthPrincipal";

type FixtureUser = {
  id: string;
  displayName?: string | null;
  primaryEmail?: string | null;
  isAnonymous?: boolean;
  clientReadOnlyMetadata?: Record<string, unknown>;
  selectedTeam?: { id: string; displayName?: string; clientReadOnlyMetadata?: Record<string, unknown> } | null;
  listTeams?: () => Promise<Array<{ id: string; displayName?: string; clientReadOnlyMetadata?: Record<string, unknown> }>>;
};

/** Adapt fixture users to the live owned authorization boundary. */
export async function ownedPrincipal(user: FixtureUser | null, headers = new Headers()): Promise<BetterAuthPrincipal | null> {
  if (!user) return null;
  const teams = await user.listTeams?.() ?? [];
  if (user.selectedTeam && !teams.some(team => team.id === user.selectedTeam!.id)) teams.push(user.selectedTeam);
  return {
    userId: user.id, displayName: user.displayName ?? "", email: user.primaryEmail ?? "fixture@example.com",
    emailVerified: true, isAnonymous: user.isAnonymous ?? false, image: null, createdAt: new Date(0),
    clientReadOnlyMetadata: user.clientReadOnlyMetadata ?? {}, sessionId: "11111111-1111-4111-8111-111111111111",
    sessionCreatedAt: new Date(0), activeOrganizationId: user.selectedTeam?.id ?? null,
    organizations: teams.map(team => ({ id: team.id, name: team.displayName ?? team.id, slug: team.id,
      image: null, role: "member", clientReadOnlyMetadata: team.clientReadOnlyMetadata ?? {} })),
    authentication: headers.has("authorization") ? "oauth" : "cookie", scopes: [],
  };
}
