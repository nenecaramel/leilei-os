import net from 'node:net';
import { chmod, lstat, mkdir, unlink } from 'node:fs/promises';
import path from 'node:path';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = () => Object.assign(new Error('NATIVE_DAEMON_DRAIN_UNCONFIRMED'), { code: 'NATIVE_DAEMON_DRAIN_UNCONFIRMED' });
const endpoint = root => path.join(root, 'daemon-control', 'handoff.sock');
const owned = info => info.uid === process.getuid() && (info.mode & 0o077) === 0;
function validReport(value) {
  return value && typeof value.ready === 'boolean' && ['closed', 'unknown'].includes(value.writer)
    && Array.isArray(value.tasks) && value.tasks.length <= 256
    && value.tasks.every(task => typeof task.id === 'string' && task.id.length <= 256 && ['stopped', 'completed', 'unknown'].includes(task.status))
    && (!value.ready || value.writer === 'closed' && value.tasks.every(task => task.status !== 'unknown'));
}
export async function createNativeSessionDrainServer({ recoveryDirectory, drain, recoverStale = false }) {
  const socketPath = endpoint(recoveryDirectory), directory = path.dirname(socketPath);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const info = await lstat(directory);
  if (!info.isDirectory() || !owned(info)) throw fail();
  try {
    const previous = await lstat(socketPath);
    let dead = false;
    // Only the daemon, after acquiring its exclusive process lock, opts in.
    // A successful connection or uncertainty always preserves the old socket.
    if (recoverStale && previous.isSocket() && owned(previous)) dead = await new Promise(resolve => {
      const probe = net.createConnection(socketPath); let settled = false;
      const finish = value => { if (settled) return; settled = true; probe.destroy(); resolve(value); };
      probe.setTimeout(500, () => finish(false)); probe.on('connect', () => finish(false));
      probe.on('error', error => finish(error.code === 'ECONNREFUSED'));
    });
    if (!dead) throw new Error('Daemon control socket already exists; do not replace an unverified owner.');
    const current = await lstat(socketPath);
    if (!current.isSocket() || !owned(current) || current.ino !== previous.ino || current.dev !== previous.dev) throw fail();
    await unlink(socketPath);
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const sockets = new Set();
  const server = net.createServer(socket => {
    if (sockets.size >= 4) { socket.destroy(); return; }
    sockets.add(socket); socket.on('error', () => {}); socket.once('close', () => sockets.delete(socket));
    socket.setTimeout(15_000, () => socket.destroy());
    let body = '', handled = false;
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      if (handled) return;
      body += chunk;
      if (Buffer.byteLength(body) > 1024) { handled = true; socket.destroy(); return; }
      if (!body.includes('\n')) return;
      handled = true;
      void (async () => {
        try {
          const request = JSON.parse(body);
          if (Object.keys(request).sort().join(',') !== 'conversationId,providerSessionId' || !uuid.test(request.conversationId) || !uuid.test(request.providerSessionId)) throw fail();
          const report = await drain(request.conversationId, request.providerSessionId);
          if (!validReport(report)) throw fail();
          socket.end(JSON.stringify({ report }) + '\n');
        } catch { socket.end(JSON.stringify({ error: 'NATIVE_DAEMON_DRAIN_UNCONFIRMED' }) + '\n'); }
      })();
    });
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(socketPath, resolve); });
  await chmod(socketPath, 0o600);
  const identity = await lstat(socketPath);
  let closed = false;
  return async () => {
    if (closed) return; closed = true;
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    try { const current = await lstat(socketPath); if (current.ino === identity.ino && current.dev === identity.dev) await unlink(socketPath); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  };
}
export async function requestNativeSessionDrain({ recoveryDirectory, conversationId, providerSessionId }) {
  if (!uuid.test(conversationId) || !uuid.test(providerSessionId)) throw fail();
  const socketPath = endpoint(recoveryDirectory);
  try {
    const directory = await lstat(path.dirname(socketPath)), socket = await lstat(socketPath);
    if (!directory.isDirectory() || !owned(directory) || !socket.isSocket() || !owned(socket)) throw fail();
  } catch (error) { if (error.code === 'ENOENT') return null; throw fail(); }
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath); let body = '', settled = false;
    const done = (error, report) => { if (settled) return; settled = true; socket.destroy(); error ? reject(fail()) : resolve(report); };
    socket.setTimeout(15_000, () => done(fail())); socket.on('error', () => done(fail()));
    socket.on('connect', () => socket.write(JSON.stringify({ conversationId, providerSessionId }) + '\n'));
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > 64 * 1024) return done(fail());
      if (!body.includes('\n')) return;
      try { const value = JSON.parse(body); if (!validReport(value.report)) throw fail(); done(null, value.report); }
      catch { done(fail()); }
    });
    socket.on('end', () => { if (!settled) done(fail()); });
  });
}
