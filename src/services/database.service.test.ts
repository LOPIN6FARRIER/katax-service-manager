import { describe, it, expect, vi } from 'vitest';
import { DatabaseService } from './database.service.js';

function primeService(
  service: DatabaseService,
  adapter: {
    query?: (pool: unknown, sql: string, params?: unknown[]) => Promise<unknown>;
    getClient?: (pool: unknown) => Promise<unknown>;
    close?: (pool: unknown) => Promise<void>;
    redis?: (pool: unknown, args: Array<string | number | Buffer>) => Promise<unknown>;
  },
  pool: unknown = {}
): void {
  (service as unknown as { initialized: boolean }).initialized = true;
  (service as unknown as { adapter: unknown }).adapter = {
    query: adapter.query ?? (async () => undefined),
    getClient: adapter.getClient ?? (async () => undefined),
    close: adapter.close ?? (async () => undefined),
    redis: adapter.redis,
  };
  (service as unknown as { pool: unknown }).pool = pool;
}

describe('DatabaseService', () => {
  it('returns typed SQL view for postgresql and mysql', () => {
    const postgres = new DatabaseService({
      name: 'main',
      type: 'postgresql',
      connection: 'postgresql://localhost/test',
    });
    const mysql = new DatabaseService({
      name: 'main',
      type: 'mysql',
      connection: 'mysql://localhost/test',
    });

    expect(postgres.asSql()).toBe(postgres);
    expect(mysql.asSql()).toBe(mysql);
  });

  it('rejects invalid typed view requests', () => {
    const redis = new DatabaseService({
      name: 'cache',
      type: 'redis',
      connection: 'redis://localhost:6379',
    });
    const mongo = new DatabaseService({
      name: 'mongo',
      type: 'mongodb',
      connection: 'mongodb://localhost:27017/test',
    });

    expect(() => redis.asSql()).toThrow('asSql() requires a postgresql or mysql connection');
    expect(() => mongo.asRedis()).toThrow('asRedis() requires a redis connection');
    expect(() => redis.asMongo()).toThrow('asMongo() requires a mongodb connection');
  });

  it('wraps query errors with a stable message', async () => {
    const service = new DatabaseService({
      name: 'main',
      type: 'postgresql',
      connection: 'postgresql://localhost/test',
    });
    primeService(service, {
      query: async () => {
        throw new Error('driver failed');
      },
    });

    await expect(service.query('SELECT 1')).rejects.toThrow('Query failed: driver failed');
  });

  it('delegates query/getClient/close to the configured adapter', async () => {
    const pool = { id: 'pool' };
    const query = vi.fn(async () => [{ id: 1 }]);
    const getClient = vi.fn(async () => ({ client: true }));
    const close = vi.fn(async () => undefined);
    const service = new DatabaseService({
      name: 'main',
      type: 'postgresql',
      connection: 'postgresql://localhost/test',
    });

    primeService(service, { query, getClient, close }, pool);

    await expect(service.query('SELECT * FROM users')).resolves.toEqual([{ id: 1 }]);
    await expect(service.getClient()).resolves.toEqual({ client: true });
    await expect(service.close()).resolves.toBeUndefined();

    expect(query).toHaveBeenCalledWith(pool, 'SELECT * FROM users', undefined);
    expect(getClient).toHaveBeenCalledWith(pool);
    expect(close).toHaveBeenCalledWith(pool);
  });

  it('executes redis commands only for redis connections', async () => {
    const redis = vi.fn(async () => 'PONG');
    const service = new DatabaseService({
      name: 'cache',
      type: 'redis',
      connection: 'redis://localhost:6379',
    });

    primeService(service, { redis });

    await expect(service.redis('PING')).resolves.toBe('PONG');
    expect(redis).toHaveBeenCalledWith({}, ['PING']);
  });

  it('rejects redis commands on non-redis connections', async () => {
    const service = new DatabaseService({
      name: 'main',
      type: 'postgresql',
      connection: 'postgresql://localhost/test',
    });

    primeService(service, {});

    await expect(service.redis('PING')).rejects.toThrow(
      'redis() method is only available for Redis connections'
    );
  });
});
