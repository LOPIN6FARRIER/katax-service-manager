import type { LogTransport, LogMessage, IDatabaseService } from '../../types.js';

/**
 * RedisTransport writes logs to a Redis Stream using XADD.
 * Requires a DatabaseService configured for Redis (IDatabaseService.redis available).
 */
export class RedisTransport implements LogTransport {
  public name?: string;

  constructor(
    private readonly db: IDatabaseService,
    private readonly streamKey = 'katax:logs',
    name?: string
  ) {
    this.name = name ?? 'redis';
    if (db.config?.type !== 'redis') {
      throw new Error('RedisTransport requires a Redis IDatabaseService');
    }
    if (!db.redis) {
      throw new Error('RedisTransport: provided database service has no redis() method');
    }
  }

  public filter?(_log: LogMessage): boolean {
    // default: persist everything (filter can be overridden by user)
    return true;
  }

  public async send(log: LogMessage): Promise<void> {
    // Prepare payload fields for XADD. Flatten metadata into a JSON field.
    const { message, broadcast, room, ...metadata } = log;
    const app = (log as any)['appName'] ?? (metadata as any)['appName'] ?? (metadata as any)['app'] ?? null;

    const fields: (string | number)[] = [];
    fields.push('level', ((metadata as any)['level'] as string) ?? 'info');
    fields.push('msg', typeof message === 'string' ? message : JSON.stringify(message));
    if (app) fields.push('app', String(app));
    fields.push('meta', JSON.stringify(metadata ?? {}));
    fields.push('timestamp', Date.now());

    // XADD <stream> * field value [field value ...]
    await this.db.redis!('XADD', this.streamKey, '*', ...fields);
  }

  public async close(): Promise<void> {
    // nothing to close here; DB connection handled by DatabaseService
  }
}
