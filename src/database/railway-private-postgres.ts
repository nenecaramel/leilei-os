const RAILWAY_TCP_PROXY_SUFFIX = ".proxy.rlwy.net";
const RAILWAY_POSTGRES_PRIVATE_HOST = "postgres.railway.internal";
const RAILWAY_POSTGRES_PRIVATE_PORT = "5432";

export function resolveRailwayMigrationDatabaseUrl(
  databaseUrl: string,
  railwayEnvironmentId: string | undefined,
): string {
  if (!railwayEnvironmentId) {
    return databaseUrl;
  }

  const url = new URL(databaseUrl);
  if (!url.hostname.endsWith(RAILWAY_TCP_PROXY_SUFFIX)) {
    return databaseUrl;
  }

  url.hostname = RAILWAY_POSTGRES_PRIVATE_HOST;
  url.port = RAILWAY_POSTGRES_PRIVATE_PORT;
  return url.toString();
}
