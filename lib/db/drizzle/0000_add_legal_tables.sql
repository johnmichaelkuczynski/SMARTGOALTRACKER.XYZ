CREATE TABLE "user_state" (
	"user_id" text PRIMARY KEY NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text NOT NULL,
	"object_path" text NOT NULL,
	"extracted_text" text DEFAULT '' NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"char_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"google_id" text,
	"email" text,
	"display_name" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_google_id_unique" UNIQUE("google_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"email" text,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "project_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"project_id" text NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"content_type" text DEFAULT 'text/plain' NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"extracted_text" text DEFAULT '' NOT NULL,
	"object_path" text DEFAULT '' NOT NULL,
	"size" bigint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "informed_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"image_data" text,
	"image_media_type" text,
	"attachments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "informed_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_messages" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"conversation_id" text,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"image_data" text,
	"image_media_type" text,
	"attachments" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "legal_conversations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"title" text DEFAULT 'New chat' NOT NULL,
	"parent_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tractatus_archive" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"job_type" text NOT NULL,
	"tier" integer NOT NULL,
	"tree_snapshot" jsonb NOT NULL,
	"node_count_at_snapshot" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tractatus_tiers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" text NOT NULL,
	"job_type" text NOT NULL,
	"tier" integer NOT NULL,
	"tree" jsonb NOT NULL,
	"node_count" integer DEFAULT 0 NOT NULL,
	"parent_tier_id" uuid,
	"compression_count" integer DEFAULT 0 NOT NULL,
	"last_update" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "documents_user_id_idx" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "projects_user_id_idx" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_messages_project_id_idx" ON "project_messages" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_messages_user_id_idx" ON "project_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "project_documents_project_id_idx" ON "project_documents" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "informed_messages_user_id_idx" ON "informed_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "informed_messages_conv_id_idx" ON "informed_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "informed_conversations_user_id_idx" ON "informed_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "legal_messages_user_id_idx" ON "legal_messages" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "legal_messages_conv_id_idx" ON "legal_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "legal_conversations_user_id_idx" ON "legal_conversations" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_tractatus_archive_job" ON "tractatus_archive" USING btree ("job_id","job_type","created_at");--> statement-breakpoint
CREATE INDEX "idx_tractatus_tiers_job" ON "tractatus_tiers" USING btree ("job_id","job_type","tier");