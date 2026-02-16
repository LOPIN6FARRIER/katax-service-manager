import { hostname, networkInterfaces } from 'os';
import { type IDatabaseService, type IWebSocketService } from '../types.js';

/**
 * Register current app version into a Redis Stream (katax:events)
 * @param db - IDatabaseService configured for Redis
 * @param opts - fields to include (app, version, port, extra)
 */
export async function registerVersionToRedis(
  db: IDatabaseService,
  opts: {
    app?: string;
    version?: string;
    port?: number | string;
    extra?: Record<string, unknown>;
  } = {}
): Promise<void> {
  if (db.config?.type !== 'redis') {
    throw new Error('registerVersionToRedis requires a Redis database connection');
  }

  const app =
    opts.app ?? process.env['KATAX_APP_NAME'] ?? process.env['npm_package_name'] ?? 'unknown';
  const version = opts.version ?? process.env['npm_package_version'] ?? '0.0.0';
  const host = hostname();
  const ip = getLocalIp();
  const pid = process.pid;
  const port = opts.port !== undefined ? String(opts.port) : undefined;
  const timestamp = String(Date.now());

  const fields: (string | number)[] = [
    'type',
    'version',
    'app',
    app,
    'version',
    version,
    'host',
    host,
    'ip',
    ip ?? '',
    'pid',
    String(pid),
    'timestamp',
    timestamp,
  ];

  if (port) {
    fields.push('port', port);
  }

  if (opts.extra) {
    fields.push('meta', JSON.stringify(opts.extra));
  }

  await db.redis!('XADD', 'katax:events', '*', ...fields);
}

/**
 * Return the first non-internal IPv4 address found on the host, or null.
 */
function getLocalIp(): string | null {
  const nets = networkInterfaces();
  for (const name of Object.keys(nets)) {
    const addrs = nets[name];
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) return addr.address;
    }
  }
  return null;
}

/**
 * Start a heartbeat that sets a presence key with TTL periodically.
 * Returns a stop function to cancel the heartbeat.
 */
export function startHeartbeat(
  db: IDatabaseService,
  opts: { app: string; port?: number | string; intervalMs?: number; ttlSeconds?: number },
  socket?: IWebSocketService
): {
  stop: () => void;
} {
  if (db.config?.type !== 'redis') {
    throw new Error('startHeartbeat requires a Redis database connection');
  }

  const app = opts.app;
  const pid = process.pid;
  const port = opts.port !== undefined ? String(opts.port) : undefined;
  const ttl = opts.ttlSeconds ?? 60;
  const interval = opts.intervalMs ?? Math.max(1000, (ttl - 10) * 1000);

  const key = `katax:service:${app}:${pid}`;

  let stopped = false;

  async function send() {
    if (stopped) return;
    const payload = {
      app,
      version: process.env['npm_package_version'] ?? '0.0.0',
      host: hostname(),
      ip: getLocalIp(),
      port: port ?? null,
      pid,
      ts: Date.now(),
    };
    try {
      await db.redis!('SET', key, JSON.stringify(payload), 'EX', String(ttl));
      if (socket) {
        try {
          socket.emit('heartbeat', payload, app);
        } catch (err) {
          // swallow; heartbeat should not throw
          // consumer can check keys existence
        }
      }
    } catch (err) {
      // swallow; heartbeat should not throw
      // consumer can check keys existence
    }
  }

  // start immediately
  void send();
  const timer = setInterval(() => void send(), interval);

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
  };
}

/**
 * Register or update a project record in Redis so dashboards can list known projects.
 * Stores a hash at `katax:project:<app>` and adds the app to the `katax:projects` set.
 */
export async function registerProjectInRedis(
  db: IDatabaseService,
  opts: {
    app?: string;
    version?: string;
    port?: number | string;
    extra?: Record<string, unknown>;
  } = {}
): Promise<void> {
  if (db.config?.type !== 'redis') {
    throw new Error('registerProjectInRedis requires a Redis database connection');
  }

  const app =
    opts.app ?? process.env['KATAX_APP_NAME'] ?? process.env['npm_package_name'] ?? 'unknown';
  const version = opts.version ?? process.env['npm_package_version'] ?? '0.0.0';
  const host = hostname();
  const ip = getLocalIp();
  const port = opts.port !== undefined ? String(opts.port) : '';
  const pid = String(process.pid);
  const updated_at = String(Date.now());

  const key = `katax:project:${app}`;

  const fields: (string | number)[] = [
    'app',
    app,
    'version',
    version,
    'host',
    host,
    'ip',
    ip ?? '',
    'port',
    port,
    'pid',
    pid,
    'updated_at',
    updated_at,
  ];

  if (opts.extra) {
    fields.push('meta', JSON.stringify(opts.extra));
  }

  // HMSET/HSET with multiple fields
  await db.redis!('HSET', key, ...fields);
  // Add to index set
  await db.redis!('SADD', 'katax:projects', app);
}
