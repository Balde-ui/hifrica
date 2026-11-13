CREATE TABLE "webhook_deliveries" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "webhook_deliveries_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"delivery_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"request_id" uuid,
	"event" text NOT NULL,
	"attempt" smallint NOT NULL,
	"outcome" text NOT NULL,
	"status_code" smallint,
	"duration_ms" integer NOT NULL,
	"destination_host" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "webhook_deliveries_outcome_chk" CHECK ("webhook_deliveries"."outcome" IN ('success', 'http_error', 'network_error', 'timeout', 'blocked', 'no_url', 'no_secret')),
	CONSTRAINT "webhook_deliveries_attempt_chk" CHECK ("webhook_deliveries"."attempt" BETWEEN 1 AND 10),
	CONSTRAINT "webhook_deliveries_status_code_range_chk" CHECK ("webhook_deliveries"."status_code" IS NULL OR "webhook_deliveries"."status_code" BETWEEN 100 AND 599),
	CONSTRAINT "webhook_deliveries_status_matches_outcome_chk" CHECK (("webhook_deliveries"."outcome" IN ('success', 'http_error')) = ("webhook_deliveries"."status_code" IS NOT NULL)),
	CONSTRAINT "webhook_deliveries_success_2xx_chk" CHECK ("webhook_deliveries"."outcome" <> 'success' OR "webhook_deliveries"."status_code" BETWEEN 200 AND 299),
	CONSTRAINT "webhook_deliveries_http_error_not_2xx_chk" CHECK ("webhook_deliveries"."outcome" <> 'http_error' OR "webhook_deliveries"."status_code" NOT BETWEEN 200 AND 299),
	CONSTRAINT "webhook_deliveries_event_chk" CHECK (char_length("webhook_deliveries"."event") BETWEEN 1 AND 200),
	CONSTRAINT "webhook_deliveries_duration_chk" CHECK ("webhook_deliveries"."duration_ms" >= 0),
	CONSTRAINT "webhook_deliveries_destination_host_chk" CHECK ("webhook_deliveries"."destination_host" IS NULL OR char_length("webhook_deliveries"."destination_host") BETWEEN 1 AND 253)
);
--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_delivery_attempt_uidx" ON "webhook_deliveries" USING btree ("delivery_id","attempt");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_project_id_id_idx" ON "webhook_deliveries" USING btree ("project_id","id" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_deliveries_created_at_idx" ON "webhook_deliveries" USING btree ("created_at");