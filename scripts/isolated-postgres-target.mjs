import postgres from 'postgres';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1']);
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function isolatedPostgresTarget(value, env = process.env) {
  if (env.RAILWAY_ENVIRONMENT_NAME?.toLowerCase() === 'production' || env.NODE_ENV?.toLowerCase() === 'production')
    throw new Error('refusing to run in a production-marked environment');
  let url;
  try { url = new URL(value); } catch { throw new Error('DATABASE_URL is not a valid URL'); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('PostgreSQL URL required');
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!LOCAL_HOSTS.has(host)) throw new Error('database host must be explicit localhost/loopback');
  // postgres.js accepts connection-option overrides from query parameters.
  if (url.search || url.hash) throw new Error('connection query parameters and fragments are not allowed');
  let database;
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { throw new Error('invalid database name encoding'); }
  if (!/^[A-Za-z0-9_-]+$/.test(database) || !/(?:test|ci|regression|ephemeral|scratch)/i.test(database))
    throw new Error('database name is not explicitly test/CI/regression-scoped');
  const port = url.port ? Number(url.port) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('invalid PostgreSQL port');
  return { url: url.href, database, port };
}

export function assertIsolatedPostgresServer(target, row) {
  if (!row || row.database !== target.database || !LOCAL_ADDRESSES.has(row.address) || Number(row.port) !== target.port)
    throw new Error('connected database/server does not match the isolated target');
}

export async function verifyIsolatedPostgresTarget(target) {
  const sql = postgres(target.url, {
    max: 1, connect_timeout: 3, idle_timeout: 1,
    connection: { statement_timeout: 5000, default_transaction_read_only: 'on' },
  });
  try {
    await sql.begin('read only', async transaction => {
      const [row] = await transaction`
        SELECT current_database() AS database,
               host(inet_server_addr()) AS address,
               inet_server_port() AS port
      `;
      assertIsolatedPostgresServer(target, row);
    });
  } catch {
    // Never echo connection errors: they can contain credentials or URL fields.
    throw new Error('isolated database connection verification failed');
  } finally { await sql.end({ timeout: 1 }); }
}
