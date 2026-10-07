-- Deployment 1: retire expired thoughts and merge feelings in place.
DELETE FROM runtime_subject_states WHERE kind = 'thought';
--> statement-breakpoint
-- Change only kind: preserve IDs, timestamps, envelopes, payload and references.
UPDATE runtime_subject_states SET kind = 'memory' WHERE kind = 'feel';
-- Deployment 2 TODO: tighten runtime_subject_states_kind_allowed to memory only
-- after all old writers are retired and production data migration is verified.
