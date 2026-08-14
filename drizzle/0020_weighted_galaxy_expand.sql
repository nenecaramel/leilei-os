DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "universe_nodes"
    WHERE cardinality("galaxies") > 0
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_revisions"
    WHERE jsonb_typeof("snapshot" -> 'galaxies') IS DISTINCT FROM 'array'
      OR jsonb_array_length(
        CASE
          WHEN jsonb_typeof("snapshot" -> 'galaxies') = 'array'
            THEN "snapshot" -> 'galaxies'
          ELSE '[]'::jsonb
        END
      ) <> 0
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_backups"
    WHERE jsonb_typeof("data" -> 'nodes') IS DISTINCT FROM 'array'
  ) OR EXISTS (
    SELECT 1
    FROM "universe_backups" AS backup
    CROSS JOIN LATERAL jsonb_array_elements(backup."data" -> 'nodes') AS node
    WHERE jsonb_typeof(node.value -> 'galaxies') IS DISTINCT FROM 'array'
      OR jsonb_array_length(
        CASE
          WHEN jsonb_typeof(node.value -> 'galaxies') = 'array'
            THEN node.value -> 'galaxies'
          ELSE '[]'::jsonb
        END
      ) <> 0
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_backups"
    WHERE jsonb_typeof("data" -> 'revisions') IS DISTINCT FROM 'array'
  ) OR EXISTS (
    SELECT 1
    FROM "universe_backups" AS backup
    CROSS JOIN LATERAL jsonb_array_elements(backup."data" -> 'revisions') AS revision
    WHERE jsonb_typeof(revision.value -> 'snapshot') IS DISTINCT FROM 'object'
      OR jsonb_typeof((revision.value -> 'snapshot') -> 'galaxies') IS DISTINCT FROM 'array'
      OR jsonb_array_length(
        CASE
          WHEN jsonb_typeof((revision.value -> 'snapshot') -> 'galaxies') = 'array'
            THEN (revision.value -> 'snapshot') -> 'galaxies'
          ELSE '[]'::jsonb
        END
      ) <> 0
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "universe_nodes" ADD COLUMN "galaxy_memberships" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "universe_nodes"
  ADD CONSTRAINT "universe_nodes_galaxy_memberships_array"
  CHECK (jsonb_typeof("universe_nodes"."galaxy_memberships") = 'array');
