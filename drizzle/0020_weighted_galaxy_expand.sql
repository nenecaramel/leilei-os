DO $$
BEGIN
  -- SHARE ROW EXCLUSIVE conflicts with the ROW EXCLUSIVE locks acquired by
  -- DML, so the census and expansion cannot be interleaved
  -- with writes from an old application version.
  LOCK TABLE "universe_nodes", "universe_revisions", "universe_backups"
    IN SHARE ROW EXCLUSIVE MODE;

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
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_revisions"
    WHERE jsonb_array_length("snapshot" -> 'galaxies') <> 0
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_backups"
    WHERE jsonb_typeof("data" -> 'nodes') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_backups" AS backup
    CROSS JOIN LATERAL jsonb_array_elements(backup."data" -> 'nodes') AS node
    WHERE jsonb_typeof(node.value -> 'galaxies') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_backups" AS backup
    CROSS JOIN LATERAL jsonb_array_elements(backup."data" -> 'nodes') AS node
    WHERE jsonb_array_length(node.value -> 'galaxies') <> 0
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_backups"
    WHERE jsonb_typeof("data" -> 'revisions') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_backups" AS backup
    CROSS JOIN LATERAL jsonb_array_elements(backup."data" -> 'revisions') AS revision
    WHERE jsonb_typeof(revision.value -> 'snapshot') IS DISTINCT FROM 'object'
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_backups" AS backup
    CROSS JOIN LATERAL jsonb_array_elements(backup."data" -> 'revisions') AS revision
    WHERE jsonb_typeof((revision.value -> 'snapshot') -> 'galaxies') IS DISTINCT FROM 'array'
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "universe_backups" AS backup
    CROSS JOIN LATERAL jsonb_array_elements(backup."data" -> 'revisions') AS revision
    WHERE jsonb_array_length((revision.value -> 'snapshot') -> 'galaxies') <> 0
  ) THEN
    RAISE EXCEPTION 'UNIVERSE_WEIGHTED_MEMBERSHIP_LEGACY_DATA_PRESENT';
  END IF;

  ALTER TABLE "universe_nodes"
    ADD COLUMN "galaxy_memberships" jsonb DEFAULT '[]'::jsonb NOT NULL;
  ALTER TABLE "universe_nodes"
    ADD CONSTRAINT "universe_nodes_galaxy_memberships_array"
    CHECK (jsonb_typeof("universe_nodes"."galaxy_memberships") = 'array');
END $$;
