export type MigrationFile = {
  folderMillis: number;
  hash: string;
  sql: string[];
};

export type AppliedMigration = {
  createdAt: number;
  hash: string;
};

export function planPendingMigrations(
  migrations: readonly MigrationFile[],
  applied: readonly AppliedMigration[],
): MigrationFile[] {
  if (migrations.length === 0) {
    throw new Error("No checked-in migrations were found.");
  }
  if (applied.length === 0) {
    throw new Error("A migration ledger bootstrap row is required.");
  }

  const orderedMigrations = [...migrations].sort(
    (left, right) => left.folderMillis - right.folderMillis,
  );
  const firstAppliedIndex = orderedMigrations.findIndex(
    (migration) => migration.folderMillis === applied[0]?.createdAt,
  );
  if (firstAppliedIndex < 0) {
    throw new Error("Migration ledger bootstrap does not match a known migration.");
  }

  for (let index = 0; index < applied.length; index += 1) {
    const ledgerEntry = applied[index];
    const expectedMigration = orderedMigrations[firstAppliedIndex + index];
    if (!ledgerEntry || !expectedMigration || expectedMigration.folderMillis !== ledgerEntry.createdAt) {
      throw new Error("Migration ledger must be contiguous from its bootstrap migration.");
    }
    if (expectedMigration.hash !== ledgerEntry.hash) {
      throw new Error("Migration ledger hash does not match the checked-in migration.");
    }
  }

  return orderedMigrations.slice(firstAppliedIndex + applied.length);
}
