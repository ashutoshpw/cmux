CREATE TABLE "auth_account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_api_key" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid,
	"organization_id" uuid,
	"token_hash" text NOT NULL UNIQUE,
	"prefix" text NOT NULL,
	"last_four" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" jsonb DEFAULT '[]' NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_api_key_one_owner" CHECK (("user_id" is not null) <> ("organization_id" is not null))
);
--> statement-breakpoint
CREATE TABLE "auth_credit_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"customer_type" text NOT NULL,
	"customer_id" text NOT NULL,
	"item_id" text NOT NULL,
	"balance" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_credit_account_balance_nonnegative" CHECK ("balance" >= 0),
	CONSTRAINT "auth_credit_account_customer_type" CHECK ("customer_type" in ('user', 'team'))
);
--> statement-breakpoint
CREATE TABLE "auth_credit_ledger" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"account_id" uuid NOT NULL,
	"operation_key" text NOT NULL UNIQUE,
	"kind" text NOT NULL,
	"amount" integer NOT NULL,
	"vm_id" uuid,
	"original_operation_key" text UNIQUE,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_credit_ledger_kind" CHECK ("kind" in ('grant', 'reserve', 'refund')),
	CONSTRAINT "auth_credit_ledger_positive_amount" CHECK ("amount" > 0),
	CONSTRAINT "auth_credit_ledger_refund_reservation" CHECK (("kind" = 'refund') = ("original_operation_key" is not null))
);
--> statement-breakpoint
CREATE TABLE "auth_invitation" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"inviter_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_jwks" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"public_key" text NOT NULL,
	"private_key" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"expires_at" timestamp,
	"alg" text,
	"crv" text
);
--> statement-breakpoint
CREATE TABLE "auth_member" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp NOT NULL,
	"display_name" text,
	"image" text
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_access_token" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"token" text NOT NULL UNIQUE,
	"client_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text,
	"requested_user_info_claims" text,
	"refresh_id" uuid,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"revoked" timestamp,
	"confirmation" jsonb,
	"scopes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_client" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"client_id" text NOT NULL UNIQUE,
	"client_secret" text,
	"client_discovery_id" text,
	"disabled" boolean DEFAULT false,
	"skip_consent" boolean,
	"enable_end_session" boolean,
	"subject_type" text,
	"scopes" text,
	"client_credentials_scopes" text DEFAULT '[]',
	"user_id" uuid,
	"created_at" timestamp,
	"updated_at" timestamp,
	"name" text,
	"uri" text,
	"icon" text,
	"contacts" text,
	"tos" text,
	"policy" text,
	"software_id" text,
	"software_version" text,
	"software_statement" text,
	"redirect_uris" text NOT NULL,
	"post_logout_redirect_uris" text,
	"backchannel_logout_uri" text,
	"backchannel_logout_session_required" boolean,
	"token_endpoint_auth_method" text,
	"application_type" text,
	"jwks" text,
	"jwks_uri" text,
	"grant_types" text,
	"response_types" text,
	"require_pkce" boolean,
	"dpop_bound_access_tokens" boolean DEFAULT false,
	"reference_id" text,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_client_assertion" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"expires_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_client_resource" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"client_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_consent" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"client_id" text NOT NULL,
	"user_id" uuid,
	"reference_id" text,
	"resources" text,
	"requested_user_info_claims" text,
	"scopes" text NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_refresh_token" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"token" text NOT NULL UNIQUE,
	"client_id" text NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"reference_id" text,
	"authorization_code_id" text,
	"resources" text,
	"requested_user_info_claims" text,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"revoked" timestamp,
	"rotated_at" timestamp,
	"rotation_replay_response" text,
	"rotation_replay_expires_at" timestamp,
	"auth_time" timestamp,
	"confirmation" jsonb,
	"scopes" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_oauth_resource" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"identifier" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"access_token_ttl" integer,
	"refresh_token_ttl" integer,
	"signing_algorithm" text,
	"signing_key_id" text,
	"allowed_scopes" text,
	"custom_claims" jsonb,
	"dpop_bound_access_tokens_required" boolean DEFAULT false,
	"disabled" boolean DEFAULT false,
	"created_at" timestamp,
	"updated_at" timestamp,
	"policy_version" integer DEFAULT 1,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "auth_organization" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"name" text NOT NULL,
	"slug" text NOT NULL UNIQUE,
	"logo" text,
	"created_at" timestamp NOT NULL,
	"metadata" text,
	"client_read_only_metadata" jsonb DEFAULT '{}',
	"server_metadata" jsonb DEFAULT '{}'
);
--> statement-breakpoint
CREATE TABLE "auth_passkey" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "auth_rate_limit" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"key" text NOT NULL UNIQUE,
	"count" integer NOT NULL,
	"last_request" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "auth_session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL UNIQUE,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	"active_organization_id" text
);
--> statement-breakpoint
CREATE TABLE "auth_two_factor" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"secret" text NOT NULL,
	"backup_codes" text NOT NULL,
	"user_id" uuid NOT NULL,
	"verified" boolean DEFAULT true,
	"failed_verification_count" integer DEFAULT 0,
	"locked_until" timestamp
);
--> statement-breakpoint
CREATE TABLE "auth_user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"name" text NOT NULL,
	"email" text NOT NULL UNIQUE,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL,
	"is_anonymous" boolean DEFAULT false,
	"two_factor_enabled" boolean DEFAULT false,
	"client_metadata" jsonb DEFAULT '{}',
	"client_read_only_metadata" jsonb DEFAULT '{}',
	"server_metadata" jsonb DEFAULT '{}',
	"selected_team_id" text
);
--> statement-breakpoint
CREATE TABLE "auth_verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE INDEX "auth_account_userId_idx" ON "auth_account" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_api_key_user_idx" ON "auth_api_key" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_api_key_organization_idx" ON "auth_api_key" ("organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_credit_account_customer_item_uidx" ON "auth_credit_account" ("customer_type","customer_id","item_id");--> statement-breakpoint
CREATE INDEX "auth_credit_ledger_account_idx" ON "auth_credit_ledger" ("account_id");--> statement-breakpoint
CREATE INDEX "auth_invitation_organizationId_idx" ON "auth_invitation" ("organization_id");--> statement-breakpoint
CREATE INDEX "auth_invitation_email_idx" ON "auth_invitation" ("email");--> statement-breakpoint
CREATE INDEX "auth_member_organizationId_idx" ON "auth_member" ("organization_id");--> statement-breakpoint
CREATE INDEX "auth_member_userId_idx" ON "auth_member" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_member_organization_user_uidx" ON "auth_member" ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_clientId_idx" ON "auth_oauth_access_token" ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_sessionId_idx" ON "auth_oauth_access_token" ("session_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_userId_idx" ON "auth_oauth_access_token" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_authorizationCodeId_idx" ON "auth_oauth_access_token" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_access_token_refreshId_idx" ON "auth_oauth_access_token" ("refresh_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_client_userId_idx" ON "auth_oauth_client" ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "auth_oauth_client_resource_clientId_resourceId_uidx" ON "auth_oauth_client_resource" ("client_id","resource_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_client_resource_clientId_idx" ON "auth_oauth_client_resource" ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_client_resource_resourceId_idx" ON "auth_oauth_client_resource" ("resource_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_consent_clientId_idx" ON "auth_oauth_consent" ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_consent_userId_idx" ON "auth_oauth_consent" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_clientId_idx" ON "auth_oauth_refresh_token" ("client_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_sessionId_idx" ON "auth_oauth_refresh_token" ("session_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_userId_idx" ON "auth_oauth_refresh_token" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_oauth_refresh_token_authorizationCodeId_idx" ON "auth_oauth_refresh_token" ("authorization_code_id");--> statement-breakpoint
CREATE INDEX "auth_passkey_userId_idx" ON "auth_passkey" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_passkey_credentialID_idx" ON "auth_passkey" ("credential_id");--> statement-breakpoint
CREATE INDEX "auth_session_userId_idx" ON "auth_session" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_two_factor_secret_idx" ON "auth_two_factor" ("secret");--> statement-breakpoint
CREATE INDEX "auth_two_factor_userId_idx" ON "auth_two_factor" ("user_id");--> statement-breakpoint
CREATE INDEX "auth_verification_identifier_idx" ON "auth_verification" ("identifier");--> statement-breakpoint
ALTER TABLE "auth_account" ADD CONSTRAINT "auth_account_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_api_key" ADD CONSTRAINT "auth_api_key_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_api_key" ADD CONSTRAINT "auth_api_key_organization_id_auth_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth_organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_credit_ledger" ADD CONSTRAINT "auth_credit_ledger_account_id_auth_credit_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth_credit_account"("id") ON DELETE RESTRICT;--> statement-breakpoint
ALTER TABLE "auth_invitation" ADD CONSTRAINT "auth_invitation_organization_id_auth_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth_organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_invitation" ADD CONSTRAINT "auth_invitation_inviter_id_auth_user_id_fkey" FOREIGN KEY ("inviter_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_member" ADD CONSTRAINT "auth_member_organization_id_auth_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "auth_organization"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_member" ADD CONSTRAINT "auth_member_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_naGWi3hIwfxW_fkey" FOREIGN KEY ("client_id") REFERENCES "auth_oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_session_id_auth_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_access_token" ADD CONSTRAINT "auth_oauth_access_token_QVDqdup4UBCC_fkey" FOREIGN KEY ("refresh_id") REFERENCES "auth_oauth_refresh_token"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_client" ADD CONSTRAINT "auth_oauth_client_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_client_resource" ADD CONSTRAINT "auth_oauth_client_resource_V3cS6twcRIpS_fkey" FOREIGN KEY ("client_id") REFERENCES "auth_oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_client_resource" ADD CONSTRAINT "auth_oauth_client_resource_fHMpUNxGXloK_fkey" FOREIGN KEY ("resource_id") REFERENCES "auth_oauth_resource"("identifier") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_consent" ADD CONSTRAINT "auth_oauth_consent_client_id_auth_oauth_client_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "auth_oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_consent" ADD CONSTRAINT "auth_oauth_consent_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_refresh_token" ADD CONSTRAINT "auth_oauth_refresh_token_UbPvdcQS9AKh_fkey" FOREIGN KEY ("client_id") REFERENCES "auth_oauth_client"("client_id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_refresh_token" ADD CONSTRAINT "auth_oauth_refresh_token_session_id_auth_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "auth_session"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_oauth_refresh_token" ADD CONSTRAINT "auth_oauth_refresh_token_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_passkey" ADD CONSTRAINT "auth_passkey_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_session" ADD CONSTRAINT "auth_session_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "auth_two_factor" ADD CONSTRAINT "auth_two_factor_user_id_auth_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth_user"("id") ON DELETE CASCADE;
--> statement-breakpoint
-- Public first-party clients use exact callbacks, PKCE, and no client secret.
INSERT INTO "auth_oauth_client" (
  "client_id", "name", "application_type", "token_endpoint_auth_method",
  "redirect_uris", "grant_types", "response_types", "scopes", "require_pkce",
  "skip_consent", "enable_end_session", "subject_type", "disabled", "created_at", "updated_at"
) VALUES
  ('cmux-w3dev-macos', 'cmux W3Dev for macOS', 'native', 'none',
   '["cmux-w3dev://auth-callback"]', '["authorization_code","refresh_token"]', '["code"]',
   '["openid","profile","email","offline_access","cmux:api"]', true, true, true, 'public', false, now(), now()),
  ('cmux-w3dev-ios', 'cmux W3Dev for iOS', 'native', 'none',
   '["cmux-w3dev-ios://auth-callback"]', '["authorization_code","refresh_token"]', '["code"]',
   '["openid","profile","email","offline_access","cmux:api"]', true, true, true, 'public', false, now(), now()),
  ('cmux-w3dev-web', 'cmux W3Dev web control plane', 'web', 'none',
   '["https://cmux.w3dev.app/handler/oauth-callback","https://staging.cmux.w3dev.app/handler/oauth-callback"]',
   '["authorization_code"]', '["code"]', '["openid","profile","email","cmux:api"]',
   true, true, false, 'public', false, now(), now());
--> statement-breakpoint
-- Separate production/staging databases and secrets issue different canonical
-- issuers. The resource verifier accepts only its own runtime audience.
INSERT INTO "auth_oauth_resource" (
  "identifier", "name", "access_token_ttl", "refresh_token_ttl", "signing_algorithm", "allowed_scopes",
  "disabled", "created_at", "updated_at"
) VALUES
  ('https://cmux.w3dev.app/api', 'cmux W3Dev API', 300, 2592000, 'ES256',
   '["openid","profile","email","offline_access","cmux:api"]', false, now(), now()),
  ('https://staging.cmux.w3dev.app/api', 'cmux W3Dev staging API', 300, 2592000, 'ES256',
   '["openid","profile","email","offline_access","cmux:api"]', false, now(), now());
--> statement-breakpoint
INSERT INTO "auth_oauth_client_resource" ("client_id", "resource_id", "created_at")
SELECT "client_id", "identifier", now()
FROM "auth_oauth_client" CROSS JOIN "auth_oauth_resource"
WHERE "client_id" IN ('cmux-w3dev-macos', 'cmux-w3dev-ios', 'cmux-w3dev-web');
