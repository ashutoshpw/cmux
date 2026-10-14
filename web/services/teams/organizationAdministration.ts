import { inArray } from "drizzle-orm";
import type { cloudDb } from "../../db/client";
import { betterAuthMember } from "../../db/betterAuthSchema";
import { accountDeletionTombstones } from "../../db/schema";
import { accountDeletionUserHash, isBlockingAccountDeletionTombstone } from "../account/deletionLock";
import { TeamApiError } from "./errors";

type Reader = Pick<Parameters<Parameters<ReturnType<typeof cloudDb>["transaction"]>[0]>[0], "select">;
export function isOrganizationAdministrator(role: string): boolean {
  return role.split(",").some(value => value === "owner" || value === "admin");
}

/** Read under the existing admin lock; deleting accounts cannot be replacement administrators. */
export async function readOrganizationAdministration(db: Reader, organizationIds: readonly string[]) {
  const members = organizationIds.length === 0 ? [] : await db.select({
    organizationId: betterAuthMember.organizationId, userId: betterAuthMember.userId, role: betterAuthMember.role,
  }).from(betterAuthMember).where(inArray(betterAuthMember.organizationId, [...organizationIds]));
  const administrators = members.filter(member => isOrganizationAdministrator(member.role));
  const hashes = [...new Set(administrators.map(member => accountDeletionUserHash(member.userId)))];
  const tombstones = hashes.length === 0 ? [] : await db.select({
    userIdHash: accountDeletionTombstones.userIdHash, status: accountDeletionTombstones.status,
    updatedAt: accountDeletionTombstones.updatedAt, analyticsDeletedAt: accountDeletionTombstones.analyticsDeletedAt,
  }).from(accountDeletionTombstones).where(inArray(accountDeletionTombstones.userIdHash, hashes));
  const deleting = new Set(tombstones.filter(value => value.analyticsDeletedAt != null || isBlockingAccountDeletionTombstone(value)).map(value => value.userIdHash));
  return {
    members,
    liveAdministratorIds: new Set(administrators.filter(member => !deleting.has(accountDeletionUserHash(member.userId))).map(member => member.userId)),
  };
}

/** Under the team admin lock, new members require an administrator who is staying. */
export async function assertOrganizationMembershipAdmission(db: Reader, organizationId: string, userId: string): Promise<void> {
  const { members, liveAdministratorIds } = await readOrganizationAdministration(db, [organizationId]);
  if (members.some(member => member.userId === userId)) return;
  if (liveAdministratorIds.size === 0) throw new TeamApiError("team_not_found", 403);
}
