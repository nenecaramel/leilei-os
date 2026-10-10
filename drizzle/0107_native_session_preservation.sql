-- A restored Desktop session remains externally owned after its app projection
-- is deleted. Keep the permission marker alongside the existing session index.
ALTER TABLE "native_live_provider_session_store_status"
  ADD COLUMN "preserve_external_session" boolean DEFAULT false NOT NULL;
