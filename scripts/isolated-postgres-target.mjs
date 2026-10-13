import postgres from 'postgres';
import { execFileSync } from 'node:child_process';

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
  const containerId = env.ISOLATED_POSTGRES_CONTAINER_ID;
  if (containerId && !/^[a-f0-9]{64}$/.test(containerId)) throw new Error('invalid isolated PostgreSQL container ID');
  return { url: url.href, database, port, containerId };
}

export function assertIsolatedPostgresServer(target, row, container) {
  const matchesDatabase = row?.database === target.database;
  if (!target.containerId) {
    if (!matchesDatabase || !LOCAL_ADDRESSES.has(row?.address) || Number(row?.port) !== target.port)
      throw new Error('connected database/server does not match the isolated target');
    return;
  }
  // Local Docker publishes the port on localhost, but PostgreSQL reports its
  // container address/internal port. Attest those through the local daemon,
  // never an arbitrary address override or a remote Docker context.
  const addresses = Object.values(container?.NetworkSettings?.Networks ?? {}).map(network => network.IPAddress);
  const bindings = container?.NetworkSettings?.Ports?.['5432/tcp'] ?? [];
  if (!matchesDatabase || container?.Id !== target.containerId || !container?.State?.Running
    || container?.Config?.Image !== 'postgres:18'
    || !container?.Config?.Env?.includes(`POSTGRES_DB=${target.database}`)
    || !addresses.includes(row?.address) || Number(row?.port) !== 5432
    || !bindings.some(binding => ['127.0.0.1', '::1', '0.0.0.0', '::'].includes(binding.HostIp)
      && Number(binding.HostPort) === target.port))
    throw new Error('connected database/server does not match the local test container');
}

function inspectLocalContainer(id) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('DOCKER_')));
  const containers = JSON.parse(execFileSync('docker', ['--host', 'unix:///var/run/docker.sock', 'inspect', id], {
    encoding: 'utf8', timeout: 3000, maxBuffer: 256 * 1024, env, stdio: ['ignore', 'pipe', 'pipe'],
  }));
  if (!Array.isArray(containers) || containers.length !== 1) throw new Error('local container inspection failed');
  return containers[0];
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
      const container = target.containerId ? inspectLocalContainer(target.containerId) : undefined;
      assertIsolatedPostgresServer(target, row, container);
    });
  } catch {
    // Never echo connection errors: they can contain credentials or URL fields.
    throw new Error('isolated database connection verification failed');
  } finally {
    try { await sql.end({ timeout: 1 }); } catch { throw new Error('isolated database connection shutdown failed'); }
  }
}
