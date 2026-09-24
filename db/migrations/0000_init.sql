CREATE TABLE "approvals" (
	"version_id" text NOT NULL,
	"person_id" text NOT NULL,
	"created_at" text NOT NULL,
	CONSTRAINT "approvals_version_id_person_id_pk" PRIMARY KEY("version_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"parent_id" text,
	"author" text NOT NULL,
	"body" text NOT NULL,
	"kind" text,
	"quote" text,
	"position" jsonb,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" text NOT NULL,
	"updated_at" text NOT NULL,
	"copy_id" text,
	"import_key" text
);
--> statement-breakpoint
CREATE TABLE "copies" (
	"id" text PRIMARY KEY NOT NULL,
	"version_id" text NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" text,
	"slack_file_id" text,
	"created_at" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "document_authors" (
	"document_id" text NOT NULL,
	"person_id" text NOT NULL,
	"position" integer NOT NULL,
	CONSTRAINT "document_authors_document_id_person_id_pk" PRIMARY KEY("document_id","person_id")
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"id" text PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"normalized_title" text NOT NULL,
	"slack_channel" text,
	"slack_thread_ts" text,
	"created_by" text,
	"created_at" text NOT NULL,
	"title_manual" integer DEFAULT 0 NOT NULL,
	"authors_confirmed" integer DEFAULT 0 NOT NULL,
	"venue" text,
	"deadline" text,
	"submitted_at" text,
	"submitted_by" text,
	"submitted_version_id" text,
	"receipt_key" text,
	"receipt_name" text,
	"skip_reason" text,
	"rejected" integer DEFAULT 0 NOT NULL,
	"published_month" text,
	"volume" text,
	"number" text,
	"pages" text,
	"paper_no" text,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"name_en" text,
	"slack_user_id" text,
	"created_at" text NOT NULL,
	CONSTRAINT "people_slack_user_id_unique" UNIQUE("slack_user_id")
);
--> statement-breakpoint
CREATE TABLE "person_names" (
	"person_id" text NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	CONSTRAINT "person_names_person_id_key_pk" PRIMARY KEY("person_id","key")
);
--> statement-breakpoint
CREATE TABLE "reminders_sent" (
	"document_id" text NOT NULL,
	"kind" text NOT NULL,
	"deadline" text NOT NULL,
	"sent_at" text NOT NULL,
	CONSTRAINT "reminders_sent_document_id_kind_deadline_pk" PRIMARY KEY("document_id","kind","deadline")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "versions" (
	"id" text PRIMARY KEY NOT NULL,
	"document_id" text NOT NULL,
	"number" integer NOT NULL,
	"filename" text NOT NULL,
	"sha256" text NOT NULL,
	"uploaded_by" text,
	"slack_file_id" text,
	"created_at" text NOT NULL,
	"title" text,
	"layout" text,
	"fingerprint" text,
	"slack_ts" text,
	"suggested_document_id" text,
	"header" text,
	CONSTRAINT "versions_number" UNIQUE("document_id","number")
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "copies" ADD CONSTRAINT "copies_version_id_versions_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_authors" ADD CONSTRAINT "document_authors_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_authors" ADD CONSTRAINT "document_authors_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "person_names" ADD CONSTRAINT "person_names_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders_sent" ADD CONSTRAINT "reminders_sent_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "versions" ADD CONSTRAINT "versions_document_id_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "comments_version" ON "comments" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "copies_version" ON "copies" USING btree ("version_id");--> statement-breakpoint
CREATE INDEX "document_authors_person" ON "document_authors" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "documents_thread" ON "documents" USING btree ("slack_channel","slack_thread_ts");--> statement-breakpoint
CREATE INDEX "documents_title" ON "documents" USING btree ("slack_channel","normalized_title");--> statement-breakpoint
CREATE INDEX "person_names_key" ON "person_names" USING btree ("key");--> statement-breakpoint
CREATE INDEX "versions_slack_file" ON "versions" USING btree ("slack_file_id");