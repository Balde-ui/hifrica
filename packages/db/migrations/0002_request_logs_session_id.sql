ALTER TABLE "request_logs" ADD COLUMN "session_id" text;--> statement-breakpoint
CREATE INDEX "request_logs_project_session_idx" ON "request_logs" USING btree ("project_id","session_id");