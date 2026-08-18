export function resolveRailwayMigrationDatabaseUrl(
  databaseUrl: string,
  _railwayEnvironmentId: string | undefined,
): string {
  // Railway pre-deploy commands receive the service's DATABASE_URL directly.
  // Keep the migration path aligned with the application path instead of
  // rewriting a public TCP-proxy URL to a hard-coded private hostname.
  return databaseUrl;
}
