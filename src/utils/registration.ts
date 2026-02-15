import { type IDatabaseService } from '../types.js';
import { hostname } from 'os';

/**
 * Register current app version into a Redis Stream (katax:events)
 * @param db - IDatabaseService configured for Redis
 * @param opts - fields to include (app, version, port, extra)
 */
export async function registerVersionToRedis(
  db: IDatabaseService,
  opts: { app?: string; version?: string; port?: number | string; extra?: Record<string, unknown> } = {}
): Promise<void> {
  if (db.config?.type !== 'redis') {
    throw new Error('registerVersionToRedis requires a Redis database connection');
  }

  const app = opts.app ?? (process.env['KATAX_APP_NAME'] ?? process.env['npm_package_name'] ?? 'unknown');
  const version = opts.version ?? process.env['npm_package_version'] ?? '0.0.0';
  const host = hostname();
  const pid = process.pid;
  const port = opts.port !== undefined ? String(opts.port) : undefined;
  const timestamp = String(Date.now());

  const fields: (string | number)[] = [
    'type', 'version',
    'app', app,
    'version', version,
    'host', host,
    'pid', String(pid),
    'timestamp', timestamp,
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
 * Start a heartbeat that sets a presence key with TTL periodically.
 * Returns a stop function to cancel the heartbeat.
 */
export function startHeartbeat(
  db: IDatabaseService,
  opts: { app: string; port?: number | string; intervalMs?: number; ttlSeconds?: number }
): { stop: () => void } {
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
    const payload = JSON.stringify({
      app,
      version: process.env['npm_package_version'] ?? '0.0.0',
      host: hostname(),
      port: port ?? null,
      pid,
      ts: Date.now(),
    });
    try {
      await db.redis!('SET', key, payload, 'EX', String(ttl));
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
