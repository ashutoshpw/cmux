// Generated with auth@1.7.7 from better-auth.generate.ts, then reviewed for app exports.
import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  bigint,
  timestamp,
  boolean,
  integer,
  uuid,
  jsonb,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";

export const betterAuthUser = pgTable("auth_user", {
  id: uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at")
    .$onUpdate(() => new Date())
    .notNull(),
  isAnonymous: boolean("is_anonymous").default(false),
  twoFactorEnabled: boolean("two_factor_enabled").default(false),
  clientMetadata: jsonb("client_metadata").default({}),
  clientReadOnlyMetadata: jsonb("client_read_only_metadata").default({}),
  serverMetadata: jsonb("server_metadata").default({}),
  selectedTeamId: text("selected_team_id"),
});

export const betterAuthSession = pgTable(
  "auth_session",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    activeOrganizationId: text("active_organization_id"),
  },
  (table) => [index("auth_session_userId_idx").on(table.userId)],
);

export const betterAuthAccount = pgTable(
  "auth_account",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("auth_account_userId_idx").on(table.userId)],
);

export const betterAuthVerification = pgTable(
  "auth_verification",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at")
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("auth_verification_identifier_idx").on(table.identifier)],
);

export const betterAuthOrganization = pgTable("auth_organization", {
  id: uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logo: text("logo"),
  createdAt: timestamp("created_at").notNull(),
  metadata: text("metadata"),
  clientReadOnlyMetadata: jsonb("client_read_only_metadata").default({}),
  serverMetadata: jsonb("server_metadata").default({}),
});

export const betterAuthMember = pgTable(
  "auth_member",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => betterAuthOrganization.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    role: text("role").default("member").notNull(),
    createdAt: timestamp("created_at").notNull(),
    displayName: text("display_name"),
    image: text("image"),
  },
  (table) => [
    index("auth_member_organizationId_idx").on(table.organizationId),
    index("auth_member_userId_idx").on(table.userId),
    uniqueIndex("auth_member_organization_user_uidx").on(table.organizationId, table.userId),
  ],
);

export const betterAuthInvitation = pgTable(
  "auth_invitation",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => betterAuthOrganization.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: text("role"),
    status: text("status").default("pending").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    inviterId: uuid("inviter_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
  },
  (table) => [
    index("auth_invitation_organizationId_idx").on(table.organizationId),
    index("auth_invitation_email_idx").on(table.email),
  ],
);

export const betterAuthTwoFactor = pgTable(
  "auth_two_factor",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    verified: boolean("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until"),
  },
  (table) => [
    index("auth_two_factor_secret_idx").on(table.secret),
    index("auth_two_factor_userId_idx").on(table.userId),
  ],
);

export const betterAuthPasskey = pgTable(
  "auth_passkey",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: boolean("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at"),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("auth_passkey_userId_idx").on(table.userId),
    index("auth_passkey_credentialID_idx").on(table.credentialID),
  ],
);

export const betterAuthJwks = pgTable("auth_jwks", {
  id: uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  publicKey: text("public_key").notNull(),
  privateKey: text("private_key").notNull(),
  createdAt: timestamp("created_at").notNull(),
  expiresAt: timestamp("expires_at"),
  alg: text("alg"),
  crv: text("crv"),
});

// OAuth array fields use JSON-encoded text, matching the built-in pg/Kysely adapter.
export const betterAuthOAuthClient = pgTable(
  "auth_oauth_client",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    clientId: text("client_id").notNull().unique(),
    clientSecret: text("client_secret"),
    clientDiscoveryId: text("client_discovery_id"),
    disabled: boolean("disabled").default(false),
    skipConsent: boolean("skip_consent"),
    enableEndSession: boolean("enable_end_session"),
    subjectType: text("subject_type"),
    scopes: text("scopes"),
    clientCredentialsScopes: text("client_credentials_scopes")
      .default("[]"),
    userId: uuid("user_id").references(() => betterAuthUser.id, {
      onDelete: "cascade",
    }),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
    name: text("name"),
    uri: text("uri"),
    icon: text("icon"),
    contacts: text("contacts"),
    tos: text("tos"),
    policy: text("policy"),
    softwareId: text("software_id"),
    softwareVersion: text("software_version"),
    softwareStatement: text("software_statement"),
    redirectUris: text("redirect_uris").notNull(),
    postLogoutRedirectUris: text("post_logout_redirect_uris"),
    backchannelLogoutUri: text("backchannel_logout_uri"),
    backchannelLogoutSessionRequired: boolean(
      "backchannel_logout_session_required",
    ),
    tokenEndpointAuthMethod: text("token_endpoint_auth_method"),
    applicationType: text("application_type"),
    jwks: text("jwks"),
    jwksUri: text("jwks_uri"),
    grantTypes: text("grant_types"),
    responseTypes: text("response_types"),
    requirePKCE: boolean("require_pkce"),
    dpopBoundAccessTokens: boolean("dpop_bound_access_tokens").default(false),
    referenceId: text("reference_id"),
    metadata: jsonb("metadata"),
  },
  (table) => [index("auth_oauth_client_userId_idx").on(table.userId)],
);

export const betterAuthOAuthResource = pgTable("auth_oauth_resource", {
  id: uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  identifier: text("identifier").notNull().unique(),
  name: text("name").notNull(),
  accessTokenTtl: integer("access_token_ttl"),
  refreshTokenTtl: integer("refresh_token_ttl"),
  signingAlgorithm: text("signing_algorithm"),
  signingKeyId: text("signing_key_id"),
  allowedScopes: text("allowed_scopes"),
  customClaims: jsonb("custom_claims"),
  dpopBoundAccessTokensRequired: boolean(
    "dpop_bound_access_tokens_required",
  ).default(false),
  disabled: boolean("disabled").default(false),
  createdAt: timestamp("created_at"),
  updatedAt: timestamp("updated_at"),
  policyVersion: integer("policy_version").default(1),
  metadata: jsonb("metadata"),
});

export const betterAuthOAuthClientResource = pgTable(
  "auth_oauth_client_resource",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => betterAuthOAuthClient.clientId, { onDelete: "cascade" }),
    resourceId: text("resource_id")
      .notNull()
      .references(() => betterAuthOAuthResource.identifier, {
        onDelete: "cascade",
      }),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at"),
  },
  (table) => [
    uniqueIndex("auth_oauth_client_resource_clientId_resourceId_uidx").on(
      table.clientId,
      table.resourceId,
    ),
    index("auth_oauth_client_resource_clientId_idx").on(table.clientId),
    index("auth_oauth_client_resource_resourceId_idx").on(table.resourceId),
  ],
);

export const betterAuthOAuthRefreshToken = pgTable(
  "auth_oauth_refresh_token",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => betterAuthOAuthClient.clientId, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => betterAuthSession.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id")
      .notNull()
      .references(() => betterAuthUser.id, { onDelete: "cascade" }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    revoked: timestamp("revoked"),
    rotatedAt: timestamp("rotated_at"),
    rotationReplayResponse: text("rotation_replay_response"),
    rotationReplayExpiresAt: timestamp("rotation_replay_expires_at"),
    authTime: timestamp("auth_time"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("auth_oauth_refresh_token_clientId_idx").on(table.clientId),
    index("auth_oauth_refresh_token_sessionId_idx").on(table.sessionId),
    index("auth_oauth_refresh_token_userId_idx").on(table.userId),
    index("auth_oauth_refresh_token_authorizationCodeId_idx").on(
      table.authorizationCodeId,
    ),
  ],
);

export const betterAuthOAuthAccessToken = pgTable(
  "auth_oauth_access_token",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    token: text("token").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => betterAuthOAuthClient.clientId, { onDelete: "cascade" }),
    sessionId: uuid("session_id").notNull().references(() => betterAuthSession.id, {
      onDelete: "cascade",
    }),
    userId: uuid("user_id").references(() => betterAuthUser.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    authorizationCodeId: text("authorization_code_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    refreshId: uuid("refresh_id").references(
      () => betterAuthOAuthRefreshToken.id,
      { onDelete: "cascade" },
    ),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at").notNull(),
    revoked: timestamp("revoked"),
    confirmation: jsonb("confirmation"),
    scopes: text("scopes").notNull(),
  },
  (table) => [
    index("auth_oauth_access_token_clientId_idx").on(table.clientId),
    index("auth_oauth_access_token_sessionId_idx").on(table.sessionId),
    index("auth_oauth_access_token_userId_idx").on(table.userId),
    index("auth_oauth_access_token_authorizationCodeId_idx").on(
      table.authorizationCodeId,
    ),
    index("auth_oauth_access_token_refreshId_idx").on(table.refreshId),
  ],
);

export const betterAuthOAuthConsent = pgTable(
  "auth_oauth_consent",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => betterAuthOAuthClient.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id").references(() => betterAuthUser.id, {
      onDelete: "cascade",
    }),
    referenceId: text("reference_id"),
    resources: text("resources"),
    requestedUserInfoClaims: text("requested_user_info_claims"),
    scopes: text("scopes").notNull(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [
    index("auth_oauth_consent_clientId_idx").on(table.clientId),
    index("auth_oauth_consent_userId_idx").on(table.userId),
  ],
);

export const betterAuthOAuthClientAssertion = pgTable(
  "auth_oauth_client_assertion",
  {
    id: uuid("id")
      .default(sql`pg_catalog.gen_random_uuid()`)
      .primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
  },
);

export const betterAuthRateLimit = pgTable("auth_rate_limit", {
  id: uuid("id")
    .default(sql`pg_catalog.gen_random_uuid()`)
    .primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/** App API keys store only a digest; the token is displayed once by the owning facade. */
export const betterAuthApiKey = pgTable("auth_api_key", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => betterAuthUser.id, { onDelete: "cascade" }),
  organizationId: uuid("organization_id").references(() => betterAuthOrganization.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  prefix: text("prefix").notNull(),
  lastFour: text("last_four").notNull(),
  description: text("description").notNull().default(""),
  permissions: jsonb("permissions").$type<readonly string[]>().notNull().default([]),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("auth_api_key_one_owner", sql`(${table.userId} is not null) <> (${table.organizationId} is not null)`),
  index("auth_api_key_user_idx").on(table.userId),
  index("auth_api_key_organization_idx").on(table.organizationId),
]);

/** Credits are app-owned transactional state, independent of the authentication provider. */
export const betterAuthCreditAccount = pgTable("auth_credit_account", {
  id: uuid("id").defaultRandom().primaryKey(),
  customerType: text("customer_type").$type<"user" | "team">().notNull(),
  customerId: text("customer_id").notNull(),
  itemId: text("item_id").notNull(),
  balance: integer("balance").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  uniqueIndex("auth_credit_account_customer_item_uidx").on(table.customerType, table.customerId, table.itemId),
  check("auth_credit_account_balance_nonnegative", sql`${table.balance} >= 0`),
  check("auth_credit_account_customer_type", sql`${table.customerType} in ('user', 'team')`),
]);

export const betterAuthCreditLedger = pgTable("auth_credit_ledger", {
  id: uuid("id").defaultRandom().primaryKey(),
  accountId: uuid("account_id").notNull().references(() => betterAuthCreditAccount.id, { onDelete: "restrict" }),
  operationKey: text("operation_key").notNull().unique(),
  kind: text("kind").$type<"grant" | "reserve" | "refund">().notNull(),
  amount: integer("amount").notNull(),
  vmId: uuid("vm_id"),
  originalOperationKey: text("original_operation_key").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  check("auth_credit_ledger_kind", sql`${table.kind} in ('grant', 'reserve', 'refund')`),
  check("auth_credit_ledger_positive_amount", sql`${table.amount} > 0`),
  check("auth_credit_ledger_refund_reservation", sql`(${table.kind} = 'refund') = (${table.originalOperationKey} is not null)`),
  index("auth_credit_ledger_account_idx").on(table.accountId),
]);
