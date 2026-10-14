import { eq, sql } from "drizzle-orm";
import type { cloudDb } from "../../db/client";
import { betterAuthMember } from "../../db/betterAuthSchema";
import { isOrganizationAdministrator, readOrganizationAdministration } from "../teams/organizationAdministration";

type Transaction = Parameters<Parameters<ReturnType<typeof cloudDb>["transaction"]>[0]>[0];
export class AccountDeletionLastOrganizationAdminError extends Error {
  override readonly name = "AccountDeletionLastOrganizationAdminError";
  constructor() { super("Transfer organization administration before deleting this account"); }
}
/** Check shared organization administration while holding the deletion-start transaction. */
export async function assertAccountDeletionOrganizationAdmins(tx: Transaction, userId: string): Promise<void> {
  const memberships = await tx.select({ organizationId: betterAuthMember.organizationId })
    .from(betterAuthMember).where(eq(betterAuthMember.userId, userId));
  const organizationIds = [...new Set(memberships.map(value => value.organizationId))].sort();
  if (organizationIds.length === 0) return;
  // Share the exact lock namespace with role changes, member removal and invitations.
  for (const id of organizationIds) {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`team-admin:${id}`}, 0))`);
  }
  const { members, liveAdministratorIds } = await readOrganizationAdministration(tx, organizationIds);
  for (const id of organizationIds) {
    const organizationMembers = members.filter(value => value.organizationId === id);
    const actor = organizationMembers.find(value => value.userId === userId);
    if (!actor || !isOrganizationAdministrator(actor.role) || organizationMembers.length < 2) continue;
    const hasReplacement = organizationMembers.some(member => member.userId !== userId && isOrganizationAdministrator(member.role) && liveAdministratorIds.has(member.userId));
    if (!hasReplacement) throw new AccountDeletionLastOrganizationAdminError();
  }
}
