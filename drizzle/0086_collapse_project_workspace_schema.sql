-- Collapse the retired two-layer Project/Workspace persistence into the
-- single Workspace product model.
--
-- This migration is intentionally fail-closed. Production was read-only
-- censused before rollout and all legacy Project/Workspace tables, runtime
-- Workspace references, and Workspace create-idempotency receipts were empty.
-- If any environment contains such state, refuse to destroy or reinterpret it.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "project_workspaces" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "projects" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "project_resources" LIMIT 1)
    OR EXISTS (SELECT 1 FROM "project_conversations" LIMIT 1)
  THEN
    RAISE EXCEPTION '0086 refused: legacy Project/Workspace tables are not empty';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "conversation_provider_session_checkpoints"
    WHERE "workspace_id" IS NOT NULL LIMIT 1
  )
    OR EXISTS (
      SELECT 1 FROM "native_live_provider_session_entries"
      WHERE "workspace_id" IS NOT NULL LIMIT 1
    )
    OR EXISTS (
      SELECT 1 FROM "native_live_provider_session_store_status"
      WHERE "workspace_id" IS NOT NULL LIMIT 1
    )
    OR EXISTS (
      SELECT 1 FROM "native_live_provider_session_cleanups"
      WHERE "workspace_id" IS NOT NULL LIMIT 1
    )
    OR EXISTS (
      SELECT 1 FROM "native_live_turn_preparations"
      WHERE "workspace_id" IS NOT NULL LIMIT 1
    )
  THEN
    RAISE EXCEPTION '0086 refused: durable runtime Workspace references exist';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "product_create_idempotency"
    WHERE "operation" IN ('workspace_create', 'workspace_resource_create')
    LIMIT 1
  )
  THEN
    RAISE EXCEPTION '0086 refused: Workspace create idempotency receipts exist';
  END IF;
END
$$;

DROP TABLE "project_conversations";
DROP TABLE "project_resources";
DROP TABLE "projects";
DROP TABLE "project_workspaces";

CREATE TABLE "workspaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspaces_id_user_unique" UNIQUE("id","user_id"),
  CONSTRAINT "workspaces_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "workspaces_name_not_blank"
    CHECK (char_length(btrim("name")) > 0),
  CONSTRAINT "workspaces_name_length"
    CHECK (char_length("name") <= 200),
  CONSTRAINT "workspaces_description_length"
    CHECK ("description" IS NULL OR char_length("description") <= 4000),
  CONSTRAINT "workspaces_version_positive"
    CHECK ("version" >= 1)
);

CREATE INDEX "workspaces_user_updated_idx"
  ON "workspaces" ("user_id", "updated_at" DESC, "id" DESC);

CREATE TABLE "workspace_resources" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "kind" varchar(32) NOT NULL,
  "resource_key" text NOT NULL,
  "title" text,
  "content" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "version" integer DEFAULT 1 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_resources_workspace_user_fk"
    FOREIGN KEY ("workspace_id","user_id")
    REFERENCES "workspaces"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_resources_workspace_kind_key_uidx"
    UNIQUE("workspace_id","kind","resource_key"),
  CONSTRAINT "workspace_resources_kind_allowed"
    CHECK ("kind" IN (
      'file','instructions','settings','skill',
      'agent','mcp','hook','plugin'
    )),
  CONSTRAINT "workspace_resources_key_not_blank"
    CHECK (char_length(btrim("resource_key")) > 0),
  CONSTRAINT "workspace_resources_key_length"
    CHECK (char_length("resource_key") <= 1000),
  CONSTRAINT "workspace_resources_title_length"
    CHECK ("title" IS NULL OR char_length("title") <= 500),
  CONSTRAINT "workspace_resources_content_length"
    CHECK ("content" IS NULL OR char_length("content") <= 1000000),
  CONSTRAINT "workspace_resources_metadata_object"
    CHECK (jsonb_typeof("metadata") = 'object'),
  CONSTRAINT "workspace_resources_version_positive"
    CHECK ("version" >= 1)
);

CREATE INDEX "workspace_resources_user_workspace_kind_idx"
  ON "workspace_resources" (
    "user_id", "workspace_id", "kind", "updated_at" DESC, "id" DESC
  );

CREATE TABLE "workspace_conversations" (
  "user_id" uuid NOT NULL,
  "workspace_id" uuid NOT NULL,
  "conversation_id" uuid NOT NULL,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "workspace_conversations_pk"
    PRIMARY KEY ("workspace_id","conversation_id"),
  CONSTRAINT "workspace_conversations_workspace_user_fk"
    FOREIGN KEY ("workspace_id","user_id")
    REFERENCES "workspaces"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "workspace_conversations_conversation_user_fk"
    FOREIGN KEY ("conversation_id","user_id")
    REFERENCES "conversations"("id","user_id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "workspace_conversations_user_workspace_added_idx"
  ON "workspace_conversations" (
    "user_id", "workspace_id", "added_at" DESC, "conversation_id" DESC
  );
