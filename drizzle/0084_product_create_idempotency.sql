CREATE TABLE "product_create_idempotency" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "operation" varchar(64) NOT NULL,
  "idempotency_key" varchar(128) NOT NULL,
  "request_hash" varchar(64) NOT NULL,
  "resource_type" varchar(32) NOT NULL,
  "resource_id" text NOT NULL,
  "response" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "product_create_idempotency_user_fk"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "product_create_idempotency_operation_allowed"
    CHECK ("operation" IN ('workspace_create','workspace_resource_create','mind_manual_create')),
  CONSTRAINT "product_create_idempotency_key_format"
    CHECK ("idempotency_key" ~ '^[A-Za-z0-9._:-]{16,128}$'),
  CONSTRAINT "product_create_idempotency_hash_format"
    CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  CONSTRAINT "product_create_idempotency_resource_type_allowed"
    CHECK ("resource_type" IN ('workspace','workspace_resource','mind_state')),
  CONSTRAINT "product_create_idempotency_response_object"
    CHECK (jsonb_typeof("response") = 'object')
);--> statement-breakpoint
CREATE UNIQUE INDEX "product_create_idempotency_user_operation_key_uidx"
  ON "product_create_idempotency"
  ("user_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "product_create_idempotency_resource_idx"
  ON "product_create_idempotency"
  ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "product_create_idempotency_created_id_idx"
  ON "product_create_idempotency"
  ("created_at","id");
