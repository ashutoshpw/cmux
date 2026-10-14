import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";
import { Effect } from "effect";
import { sql } from "drizzle-orm";
import { cloudDb, closeCloudDbForTests } from "../db/client";
import { getStackServerApp } from "../app/lib/stack";
import { withFreshAccountMetadataUser } from "../services/account/metadataMutation";
import { loadTeamAccess } from "../services/teams/access";
import { defaultTeamStackApp } from "../services/teams/stack";
import { changeMemberRole, removeMember } from "../services/teams/members";
import { withTeamAdminLock } from "../services/teams/repository";
import { assertAccountDeletionOrganizationAdmins } from "../services/account/organizationDeletionGuard";
import { acceptReceivedInvitation, acceptEmailInvitationToken } from "../services/teams/received";
import { redeemTeamInviteLink, generateInviteLinkToken, hashInviteLinkToken } from "../services/teams/links";

const runDbTests = process.env.CMUX_DB_TEST === "1";
const dbTest = runDbTests ? test : test.skip;
// Only external network detach is replaced. Membership, snapshots, invite
// redemptions and CodeRouter revocations still use the real database.
if (runDbTests) {
  const network = await import("../services/vms/teamNetworkAccess");
  mock.module("../services/vms/teamNetworkAccess", () => ({ ...network, revokeTeamNetworkAccess: () => Effect.succeed({ detached: 0 }) }));
}
let pool: Pool;
let owner: string;
let administrator: string;
let organization: string;
const originalPoolMax = process.env.CMUX_DB_POOL_MAX;

beforeAll(async () => {
  if (!runDbTests) return;
  const url = process.env.DATABASE_URL;
  if (!url || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("A disposable loopback DATABASE_URL is required for owned team transaction tests");
  pool = new Pool({ connectionString: url, max: 2 });
  const exists = await pool.query("select to_regclass('auth_user') as table_name");
  if (!exists.rows[0].table_name) await pool.query(await readFile(new URL("../db/migrations/20261014113000_better_auth_fork/migration.sql", import.meta.url), "utf8"));
  await pool.query(`
    create table if not exists account_deletion_tombstones(user_id_hash text primary key,user_id text,status text not null,updated_at timestamptz not null default now(),analytics_deleted_at timestamptz);
    create table if not exists account_mutation_leases(user_id_hash text primary key,operation_id uuid not null,created_at timestamptz not null default now(),expires_at timestamptz not null,updated_at timestamptz not null);
    alter table account_mutation_leases add column if not exists created_at timestamptz not null default now();
    create table if not exists stack_identity_snapshots(user_id text primary key);
    create table if not exists coderouter_route_tokens(id uuid primary key,team_id text,stack_user_id text,vm_id text,revoked_at timestamptz);
    create table if not exists team_invite_links(id uuid primary key,stack_team_id text);
    create table if not exists team_invite_link_redemptions(link_id uuid,user_id text);
    alter table team_invite_links add column if not exists token_hash text;
    alter table team_invite_links add column if not exists role text not null default 'member';
    alter table team_invite_links add column if not exists created_by_user_id text;
    alter table team_invite_links add column if not exists created_at timestamptz not null default now();
    alter table team_invite_links add column if not exists expires_at timestamptz;
    alter table team_invite_links add column if not exists revoked_at timestamptz;
    alter table team_invite_links add column if not exists max_uses integer;
    alter table team_invite_links add column if not exists use_count integer not null default 0;
    alter table team_invite_link_redemptions add column if not exists redeemed_at timestamptz not null default now();
    create unique index if not exists team_invite_link_redemptions_test_unique on team_invite_link_redemptions(link_id,user_id);
    create table if not exists team_email_invitations(id uuid primary key,stack_team_id text not null,email text not null,role text not null default 'member',invited_by_user_id text not null,token_hash text not null,created_at timestamptz not null default now(),last_sent_at timestamptz not null default now(),expires_at timestamptz not null,revoked_at timestamptz,accepted_at timestamptz,accepted_by_user_id text,declined_at timestamptz);
  `);
});
beforeEach(async () => {
  if (!runDbTests) return;
  await closeCloudDbForTests();
  process.env.CMUX_DB_POOL_MAX = "5";
  await pool.query("truncate auth_member, auth_organization, auth_user cascade");
  await pool.query("truncate account_deletion_tombstones, account_mutation_leases, coderouter_route_tokens, stack_identity_snapshots, team_invite_links, team_invite_link_redemptions, team_email_invitations");
  owner = randomUUID(); administrator = randomUUID(); organization = randomUUID();
  await pool.query("insert into auth_user(id,name,email,email_verified,created_at,updated_at) values($1,'Owner',$2,true,now(),now()),($3,'Admin',$4,true,now(),now())", [owner, `${owner}@example.test`, administrator, `${administrator}@example.test`]);
  await pool.query("insert into auth_organization(id,name,slug,created_at) values($1,'Shared organization',$2,now())", [organization, organization]);
  await pool.query("insert into auth_member(id,organization_id,user_id,role,created_at) values($1,$2,$3,'owner',now()),($4,$2,$5,'admin',now())", [randomUUID(), organization, owner, randomUUID(), administrator]);
});
afterAll(async () => {
  if (!runDbTests) return;
  await closeCloudDbForTests(); await pool.end();
  if (originalPoolMax === undefined) delete process.env.CMUX_DB_POOL_MAX;
  else process.env.CMUX_DB_POOL_MAX = originalPoolMax;
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
async function waitForLockWaiters(count: number) {
  const limit = Date.now() + 3000;
  while (Date.now() < limit) {
    const result = await pool.query("select count(*)::int as count from pg_stat_activity where datname=current_database() and wait_event_type='Lock' and wait_event='advisory'");
    if (result.rows[0].count === count) return;
    await new Promise<void>(resolve => setTimeout(resolve, 10));
  }
  throw new Error(`Expected ${count} real PostgreSQL advisory-lock waiters`);
}
async function pendingDeletion(userId: string) {
  await pool.query("insert into account_deletion_tombstones(user_id_hash,user_id,status) values($1,$2,'pending')", [createHash("sha256").update(userId).digest("hex"), userId]);
}
const seats = { membershipChanged: async () => undefined };

describe("owned team transaction boundaries", () => {
  for (const admission of ["direct", "received", "email-token", "link"] as const) {
    dbTest(`${admission} admission cannot strand a member after the sole owner's deletion starts`, async () => {
      await pool.query("delete from auth_member where user_id=$1", [administrator]);
      const invitationId = randomUUID(); const token = generateInviteLinkToken();
      if (admission === "link") {
        await pool.query("insert into team_invite_links(id,stack_team_id,token_hash,created_by_user_id) values($1,$2,$3,$4)", [invitationId, organization, hashInviteLinkToken(token), owner]);
      } else if (admission !== "direct") {
        await pool.query("insert into team_email_invitations(id,stack_team_id,email,invited_by_user_id,token_hash,expires_at) values($1,$2,$3,$4,$5,now()+interval '1 day')", [invitationId, organization, `${administrator}@example.test`, owner, hashInviteLinkToken(token)]);
      }
      await cloudDb().transaction(async tx => {
        await assertAccountDeletionOrganizationAdmins(tx, owner);
        await tx.execute(sql`insert into account_deletion_tombstones(user_id_hash,user_id,status) values(${createHash("sha256").update(owner).digest("hex")},${owner},'pending')`);
      });
      const join = async () => {
        if (admission === "direct") await (await getStackServerApp().getTeam(organization))!.addUser(administrator);
        else if (admission === "received") await acceptReceivedInvitation(administrator, invitationId, { seats });
        else if (admission === "email-token") await acceptEmailInvitationToken(administrator, token, { seats });
        else await redeemTeamInviteLink(administrator, token, { seats });
      };
      const result = await join().then(() => null, error => error);
      await (await getStackServerApp().getUser(owner))!.delete();
      expect(result).toMatchObject({ code: "team_not_found", status: 403 });
      expect(Number((await pool.query("select count(*) from auth_member where organization_id=$1", [organization])).rows[0].count)).toBe(0);
      if (admission === "link") {
        expect((await pool.query("select use_count from team_invite_links where id=$1", [invitationId])).rows[0].use_count).toBe(0);
        expect(Number((await pool.query("select count(*) from team_invite_link_redemptions where link_id=$1", [invitationId])).rows[0].count)).toBe(0);
      } else if (admission !== "direct") {
        expect((await pool.query("select accepted_at from team_email_invitations where id=$1", [invitationId])).rows[0].accepted_at).toBeNull();
      }
    });
  }
  dbTest("admission stays available with a live administrator while another owner's deletion is pending", async () => {
    process.env.CMUX_DB_POOL_MAX = "1";
    const joiningUser = randomUUID();
    await pool.query("insert into auth_user(id,name,email,email_verified,created_at,updated_at) values($1,'Joining User',$2,true,now(),now())", [joiningUser, `${joiningUser}@example.test`]);
    await pendingDeletion(owner);
    await withTeamAdminLock(organization, async () => {
      await (await getStackServerApp().getTeam(organization))!.addUser(joiningUser);
    });
    await (await getStackServerApp().getUser(owner))!.delete();
    const rows = await pool.query("select user_id,role from auth_member where organization_id=$1", [organization]);
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.find(row => row.user_id === administrator)?.role).toBe("admin");
    expect(rows.rows.find(row => row.user_id === joiningUser)?.role).toBe("member");
  });
  dbTest("a one-connection pool loads owned team access while holding its admin lock", async () => {
    process.env.CMUX_DB_POOL_MAX = "1";
    const result = await Promise.allSettled([withTeamAdminLock(organization, () => loadTeamAccess(owner, organization, defaultTeamStackApp()))]);
    expect(result[0]?.status).toBe("fulfilled");
    if (result[0]?.status === "fulfilled") expect(result[0].value?.role).toBe("admin");
  }, 20000);
  dbTest("five concurrent admin-lock requests finish with the default five-connection pool", async () => {
    const entered = deferred(); const release = deferred();
    const holder = withTeamAdminLock(organization, async () => {
      entered.resolve(); await release.promise;
      return loadTeamAccess(owner, organization, defaultTeamStackApp());
    });
    await entered.promise;
    const waiters = Array.from({ length: 4 }, () => withTeamAdminLock(organization, () => loadTeamAccess(owner, organization, defaultTeamStackApp())));
    try { await waitForLockWaiters(4); } finally { release.resolve(); }
    const results = await Promise.allSettled([holder, ...waiters]);
    expect(results.map(value => value.status)).toEqual(Array.from({ length: 5 }, () => "fulfilled"));
  }, 30000);
  dbTest("owned member removal revokes database access on the admin lock's single connection", async () => {
    process.env.CMUX_DB_POOL_MAX = "1";
    const tokenId = randomUUID(); const linkId = randomUUID();
    await pool.query("insert into stack_identity_snapshots(user_id) values($1)", [administrator]);
    await pool.query("insert into coderouter_route_tokens(id,team_id,stack_user_id) values($1,$2,$3)", [tokenId, organization, administrator]);
    await pool.query("insert into team_invite_links(id,stack_team_id) values($1,$2)", [linkId, organization]);
    await pool.query("insert into team_invite_link_redemptions(link_id,user_id) values($1,$2)", [linkId, administrator]);
    const access = await loadTeamAccess(owner, organization, defaultTeamStackApp());
    await removeMember(access!, administrator, { seats });
    expect(Number((await pool.query("select count(*) from auth_member where organization_id=$1 and user_id=$2", [organization, administrator])).rows[0].count)).toBe(0);
    expect(Number((await pool.query("select count(*) from stack_identity_snapshots where user_id=$1", [administrator])).rows[0].count)).toBe(0);
    expect((await pool.query("select revoked_at from coderouter_route_tokens where id=$1", [tokenId])).rows[0].revoked_at).not.toBeNull();
    expect(Number((await pool.query("select count(*) from team_invite_link_redemptions where link_id=$1 and user_id=$2", [linkId, administrator])).rows[0].count)).toBe(0);
  });
  dbTest("account metadata leases release their connection before the owned loader and update", async () => {
    process.env.CMUX_DB_POOL_MAX = "1";
    await withFreshAccountMetadataUser({ db: cloudDb(), userId: owner, loader: getStackServerApp(), operation: async (user, lease) => {
      await lease.refresh(); await user.update({ clientReadOnlyMetadata: { retained: true } });
    } });
    expect((await pool.query("select client_read_only_metadata from auth_user where id=$1", [owner])).rows[0].client_read_only_metadata).toEqual({ retained: true });
    expect(Number((await pool.query("select count(*) as count from account_mutation_leases")).rows[0].count)).toBe(0);
  });
  dbTest("a delayed owned auth write cannot escape a completed team transaction", async () => {
    const release = deferred();
    let escaped!: Promise<void>;
    await withTeamAdminLock(organization, async () => {
      escaped = (async () => {
        await release.promise;
        const user = await getStackServerApp().getUser(owner);
        await user!.update({ clientReadOnlyMetadata: { escaped: true } });
      })();
    });
    release.resolve();
    await expect(escaped).rejects.toThrow("Database transaction scope has closed");
    expect((await pool.query("select client_read_only_metadata from auth_user where id=$1", [owner])).rows[0].client_read_only_metadata).toEqual({});
  });
  dbTest("a failed nested team operation rolls back its savepoint and preserves the outer write", async () => {
    process.env.CMUX_DB_POOL_MAX = "1";
    await withTeamAdminLock(organization, async () => {
      const user = await getStackServerApp().getUser(owner);
      await user!.update({ clientReadOnlyMetadata: { outer: true } });
      await expect(withTeamAdminLock(organization, async () => {
        const nestedUser = await getStackServerApp().getUser(owner);
        await nestedUser!.update({ clientReadOnlyMetadata: { nested: true } });
        throw new Error("nested operation failed");
      })).rejects.toThrow("nested operation failed");
      const retained = await getStackServerApp().getUser(owner);
      expect(retained!.clientReadOnlyMetadata).toEqual({ outer: true });
      await retained!.update({ clientReadOnlyMetadata: { outer: true, continued: true } });
    });
    expect((await pool.query("select client_read_only_metadata from auth_user where id=$1", [owner])).rows[0].client_read_only_metadata).toEqual({ outer: true, continued: true });
  });
  dbTest("a closed nested scope cannot route a delayed write through its active parent", async () => {
    process.env.CMUX_DB_POOL_MAX = "1";
    await withTeamAdminLock(organization, async () => {
      const release = deferred();
      let escaped!: Promise<void>;
      await withTeamAdminLock(organization, async () => {
        escaped = (async () => {
          await release.promise;
          const user = await getStackServerApp().getUser(owner);
          await user!.update({ clientReadOnlyMetadata: { escapedChild: true } });
        })();
      });
      release.resolve();
      await expect(escaped).rejects.toThrow("Database transaction scope has closed");
      const user = await getStackServerApp().getUser(owner);
      expect(user!.clientReadOnlyMetadata).toEqual({});
      await user!.update({ clientReadOnlyMetadata: { parent: true } });
    });
    expect((await pool.query("select client_read_only_metadata from auth_user where id=$1", [owner])).rows[0].client_read_only_metadata).toEqual({ parent: true });
  });
  dbTest("concurrent transaction scopes isolate a rolled-back owned write from a committed write", async () => {
    const otherOrganization = randomUUID();
    await pool.query("insert into auth_organization(id,name,slug,created_at) values($1,'Other organization',$2,now())", [otherOrganization, otherOrganization]);
    const entered = deferred(); const release = deferred();
    const rolledBack = withTeamAdminLock(organization, async () => {
      const user = await getStackServerApp().getUser(owner);
      await user!.update({ clientReadOnlyMetadata: { rolledBack: true } });
      entered.resolve(); await release.promise;
      throw new Error("outer operation failed");
    });
    const rejected = rolledBack.then(() => null, error => error);
    await entered.promise;
    try {
      await withTeamAdminLock(otherOrganization, async () => {
        const user = await getStackServerApp().getUser(administrator);
        await user!.update({ clientReadOnlyMetadata: { committed: true } });
      });
    } finally { release.resolve(); }
    expect(await rejected).toMatchObject({ message: "outer operation failed" });
    const rows = await pool.query("select id,client_read_only_metadata from auth_user where id=any($1)", [[owner, administrator]]);
    expect(rows.rows.find(row => row.id === owner).client_read_only_metadata).toEqual({});
    expect(rows.rows.find(row => row.id === administrator).client_read_only_metadata).toEqual({ committed: true });
  });

  dbTest("a deleting administrator cannot justify demoting the sole remaining live administrator", async () => {
    await pendingDeletion(owner);
    const access = await loadTeamAccess(administrator, organization, defaultTeamStackApp());
    expect(access).not.toBeNull();
    await expect(changeMemberRole(access!, administrator, "member")).rejects.toMatchObject({ code: "last_admin", status: 409 });
    expect((await pool.query("select role from auth_member where organization_id=$1 and user_id=$2", [organization, administrator])).rows[0].role).toBe("admin");
  });
  dbTest("a deleting administrator cannot justify removing the sole remaining live administrator", async () => {
    await pendingDeletion(owner);
    const access = await loadTeamAccess(administrator, organization, defaultTeamStackApp());
    expect(access).not.toBeNull();
    await expect(removeMember(access!, administrator, { seats })).rejects.toMatchObject({ code: "last_admin", status: 409 });
    expect((await pool.query("select role from auth_member where organization_id=$1 and user_id=$2", [organization, administrator])).rows[0].role).toBe("admin");
  });
});
