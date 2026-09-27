-- Durable Projects / Workspace product domain.
--
-- Railway/Postgres owns logical Workspace/Project state. Project resources are
-- durable product documents, not mirrors of an arbitrary local filesystem.
-- Project/conversation membership references the canonical conversation ledger
-- without changing conversation ownership or lifecycle.

CREATE TABLE "project_workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_workspaces_id_user_unique" UNIQUE("id","user_id"),
  CONSTRAINT "project_workspaces_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "project_workspaces_name_not_blank"
    CHECK (char_length(btrim("name")) > 0),
  CONSTRAINT "project_workspaces_name_length"
    CHECK (char_length("name") <= 200),
  CONSTRAINT "project_workspaces_description_length"
    CHECK ("description" IS NULL OR char_length("description") <= 4000),
  CONSTRAINT "project_workspaces_version_positive"
    CHECK ("version" >= 1)
);

CREATE INDEX "project_workspaces_user_updated_idx"
  ON "project_workspaces" ("user_id", "updated_at" DESC, "id" DESC);

CREATE TABLE "projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "projects_id_user_unique" UNIQUE("id","user_id"),
  CONSTRAINT "projects_workspace_user_fk"
    FOREIGN KEY ("workspace_id","user_id")
    REFERENCES "project_workspaces"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "projects_name_not_blank"
    CHECK (char_length(btrim("name")) > 0),
  CONSTRAINT "projects_name_length"
    CHECK (char_length("name") <= 200),
  CONSTRAINT "projects_description_length"
    CHECK ("description" IS NULL OR char_length("description") <= 4000),
  CONSTRAINT "projects_version_positive"
    CHECK ("version" >= 1)
);

CREATE INDEX "projects_user_workspace_updated_idx"
  ON "projects" ("user_id", "workspace_id", "updated_at" DESC, "id" DESC);

CREATE TABLE "project_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "kind" varchar(32) NOT NULL,
  "resource_key" text NOT NULL,
  "title" text,
  "content" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_resources_project_user_fk"
    FOREIGN KEY ("project_id","user_id")
    REFERENCES "projects"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_resources_project_kind_key_uidx"
    UNIQUE("project_id","kind","resource_key"),
  CONSTRAINT "project_resources_kind_allowed"
    CHECK ("kind" IN (
      'file','instructions','settings','skill',
      'agent','mcp','hook','plugin'
    )),
  CONSTRAINT "project_resources_key_not_blank"
    CHECK (char_length(btrim("resource_key")) > 0),
  CONSTRAINT "project_resources_key_length"
    CHECK (char_length("resource_key") <= 1000),
  CONSTRAINT "project_resources_title_length"
    CHECK ("title" IS NULL OR char_length("title") <= 500),
  CONSTRAINT "project_resources_content_length"
    CHECK ("content" IS NULL OR char_length("content") <= 1000000),
  CONSTRAINT "project_resources_metadata_object"
    CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "project_resources_version_positive"
    CHECK ("version" >= 1)
);

CREATE INDEX "project_resources_user_project_kind_idx"
  ON "project_resources" ("user_id", "project_id", "kind", "updated_at" DESC, "id" DESC);

CREATE TABLE "project_conversations" (
  "user_id" uuid NOT NULL,
  "project_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "project_conversations_pk"
    PRIMARY KEY ("project_id","conversation_id"),
  CONSTRAINT "project_conversations_project_user_fk"
    FOREIGN KEY ("project_id","user_id")
    REFERENCES "projects"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_conversations_conversation_user_fk"
    FOREIGN KEY ("conversation_id","user_id")
    REFERENCES "conversations"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "project_conversations_user_project_added_idx"
  ON "project_conversations" ("user_id", "project_id", "added_at" DESC, "conversation_id" DESC);
