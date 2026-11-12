CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
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
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "sessions_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"role" text DEFAULT 'user' NOT NULL,
	"country" text,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verifications" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"name" text NOT NULL,
	"webhook_url" text,
	"webhook_secret_enc" text NOT NULL,
	"webhook_secret_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_name_chk" CHECK (char_length("projects"."name") BETWEEN 1 AND 80 AND "projects"."name" = btrim("projects"."name")),
	CONSTRAINT "projects_webhook_url_chk" CHECK ("projects"."webhook_url" IS NULL OR ("projects"."webhook_url" ~ '^https?://' AND char_length("projects"."webhook_url") <= 2048)),
	CONSTRAINT "projects_webhook_secret_enc_chk" CHECK ("projects"."webhook_secret_enc" ~ '^v[0-9]+:[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$')
);
--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"name" text,
	"key_hash" "bytea" NOT NULL,
	"prefix" text NOT NULL,
	"last4" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_len_chk" CHECK (octet_length("api_keys"."key_hash") = 32),
	CONSTRAINT "api_keys_prefix_chk" CHECK ("api_keys"."prefix" ~ '^sk_test_[0-9A-Za-z]{4}$'),
	CONSTRAINT "api_keys_last4_chk" CHECK ("api_keys"."last4" ~ '^[0-9A-Za-z]{4}$'),
	CONSTRAINT "api_keys_name_chk" CHECK ("api_keys"."name" IS NULL OR char_length("api_keys"."name") BETWEEN 1 AND 60),
	CONSTRAINT "api_keys_revoked_after_created_chk" CHECK ("api_keys"."revoked_at" IS NULL OR "api_keys"."revoked_at" >= "api_keys"."created_at")
);
--> statement-breakpoint
CREATE TABLE "simulator_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"simulator_id" uuid NOT NULL,
	"version" text NOT NULL,
	"yaml" text NOT NULL,
	"is_current" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulator_versions_semver_chk" CHECK ("simulator_versions"."version" ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
	CONSTRAINT "simulator_versions_yaml_size_chk" CHECK (octet_length("simulator_versions"."yaml") <= 65536)
);
--> statement-breakpoint
CREATE TABLE "simulators" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"owner_id" uuid,
	"kind" text NOT NULL,
	"description" text,
	"origin" text DEFAULT 'manual' NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"author_reviewed_at" timestamp with time zone,
	"forked_from_id" uuid,
	"license" text DEFAULT 'CC-BY-4.0' NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "simulators_slug_chk" CHECK ("simulators"."slug" ~ '^[a-z0-9-]{3,60}$'),
	CONSTRAINT "simulators_kind_chk" CHECK ("simulators"."kind" IN ('http', 'ussd')),
	CONSTRAINT "simulators_origin_chk" CHECK ("simulators"."origin" IN ('manual', 'ai')),
	CONSTRAINT "simulators_status_chk" CHECK ("simulators"."status" IN ('draft', 'to_verify', 'verified', 'unpublished')),
	CONSTRAINT "simulators_description_chk" CHECK ("simulators"."description" IS NULL OR char_length("simulators"."description") <= 1000),
	CONSTRAINT "simulators_not_self_fork_chk" CHECK ("simulators"."forked_from_id" IS NULL OR "simulators"."forked_from_id" <> "simulators"."id")
);
--> statement-breakpoint
CREATE TABLE "project_simulators" (
	"project_id" uuid NOT NULL,
	"simulator_id" uuid NOT NULL,
	"active_scenario_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_simulators_pk" PRIMARY KEY("project_id","simulator_id"),
	CONSTRAINT "project_simulators_active_scenario_key_chk" CHECK ("project_simulators"."active_scenario_key" IS NULL OR (char_length("project_simulators"."active_scenario_key") BETWEEN 1 AND 60 AND "project_simulators"."active_scenario_key" = btrim("project_simulators"."active_scenario_key")))
);
--> statement-breakpoint
CREATE TABLE "request_logs" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "request_logs_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"request_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"api_key_id" uuid,
	"simulator_id" uuid,
	"simulator_version_id" uuid,
	"simulator_slug" text NOT NULL,
	"channel" text DEFAULT 'http' NOT NULL,
	"source" text DEFAULT 'api' NOT NULL,
	"outcome" text NOT NULL,
	"endpoint_id" text,
	"scenario_key" text,
	"method" text NOT NULL,
	"path" text NOT NULL,
	"status" smallint,
	"error_code" text,
	"duration_ms" integer NOT NULL,
	"request" jsonb NOT NULL,
	"response" jsonb,
	"truncated" boolean DEFAULT false NOT NULL,
	"replay_of_id" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "request_logs_channel_chk" CHECK ("request_logs"."channel" IN ('http', 'ussd', 'sms')),
	CONSTRAINT "request_logs_source_chk" CHECK ("request_logs"."source" IN ('api', 'replay', 'editor', 'phone')),
	CONSTRAINT "request_logs_outcome_chk" CHECK ("request_logs"."outcome" IN ('responded', 'client_aborted', 'response_failed', 'timeout')),
	CONSTRAINT "request_logs_status_range_chk" CHECK ("request_logs"."status" IS NULL OR "request_logs"."status" BETWEEN 100 AND 599),
	CONSTRAINT "request_logs_http_status_matches_outcome_chk" CHECK ("request_logs"."channel" <> 'http' OR (("request_logs"."outcome" = 'responded') = ("request_logs"."status" IS NOT NULL))),
	CONSTRAINT "request_logs_response_only_if_responded_chk" CHECK ("request_logs"."outcome" = 'responded' OR "request_logs"."response" IS NULL),
	CONSTRAINT "request_logs_error_code_chk" CHECK ("request_logs"."error_code" IS NULL OR "request_logs"."error_code" ~ '^[a-z][a-z0-9_.]{0,63}$'),
	CONSTRAINT "request_logs_method_chk" CHECK (char_length("request_logs"."method") BETWEEN 1 AND 10),
	CONSTRAINT "request_logs_path_chk" CHECK (char_length("request_logs"."path") <= 2048),
	CONSTRAINT "request_logs_duration_chk" CHECK ("request_logs"."duration_ms" >= 0)
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulator_versions" ADD CONSTRAINT "simulator_versions_simulator_id_simulators_id_fk" FOREIGN KEY ("simulator_id") REFERENCES "public"."simulators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulator_versions" ADD CONSTRAINT "simulator_versions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulators" ADD CONSTRAINT "simulators_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "simulators" ADD CONSTRAINT "simulators_forked_from_id_simulators_id_fk" FOREIGN KEY ("forked_from_id") REFERENCES "public"."simulators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_simulators" ADD CONSTRAINT "project_simulators_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_simulators" ADD CONSTRAINT "project_simulators_simulator_id_simulators_id_fk" FOREIGN KEY ("simulator_id") REFERENCES "public"."simulators"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_api_key_id_api_keys_id_fk" FOREIGN KEY ("api_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_simulator_id_simulators_id_fk" FOREIGN KEY ("simulator_id") REFERENCES "public"."simulators"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_simulator_version_id_simulator_versions_id_fk" FOREIGN KEY ("simulator_version_id") REFERENCES "public"."simulator_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "request_logs" ADD CONSTRAINT "request_logs_replay_of_id_request_logs_id_fk" FOREIGN KEY ("replay_of_id") REFERENCES "public"."request_logs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accounts_provider_account_uidx" ON "accounts" USING btree ("provider_id","account_id");--> statement-breakpoint
CREATE INDEX "accounts_userId_idx" ON "accounts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_userId_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verifications_identifier_idx" ON "verifications" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "projects_owner_id_idx" ON "projects" USING btree ("owner_id");--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_key_hash_uidx" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_project_id_idx" ON "api_keys" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "api_keys_project_active_idx" ON "api_keys" USING btree ("project_id") WHERE "api_keys"."revoked_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "simulator_versions_simulator_version_uidx" ON "simulator_versions" USING btree ("simulator_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "simulator_versions_one_current_uidx" ON "simulator_versions" USING btree ("simulator_id") WHERE "simulator_versions"."is_current";--> statement-breakpoint
CREATE UNIQUE INDEX "simulators_slug_uidx" ON "simulators" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "simulators_status_kind_idx" ON "simulators" USING btree ("status","kind");--> statement-breakpoint
CREATE INDEX "simulators_owner_id_idx" ON "simulators" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX "project_simulators_simulator_id_idx" ON "project_simulators" USING btree ("simulator_id");--> statement-breakpoint
CREATE UNIQUE INDEX "request_logs_request_id_uidx" ON "request_logs" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "request_logs_project_id_id_idx" ON "request_logs" USING btree ("project_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "request_logs_created_at_idx" ON "request_logs" USING btree ("created_at");