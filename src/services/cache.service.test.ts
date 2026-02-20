import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CacheService } from './cache.service.js';
import type { IDatabaseService } from '../types.js';

describe('CacheService.clear', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(() => {
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(() => {
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('uses SCAN batches and returns deleted count', async () => {
    const redis = vi
      .fn()
      .mockImplementationOnce(async () => ['1', ['k1', 'k2']])
      .mockImplementationOnce(async () => 2)
      .mockImplementationOnce(async () => ['0', ['k3']])
      .mockImplementationOnce(async () => 1);

    const databaseMock: IDatabaseService = {
      config: {
        type: 'redis',
        connection: 'redis://localhost:6379',
      },
      init: async () => undefined,
      query: async <T>() => [] as unknown as T,
      getClient: async () => ({}),
      redis,
      close: async () => undefined,
    };

    const service = new CacheService(databaseMock);

    const deleted = await service.clear('user:*');

    expect(deleted).toBe(3);
    expect(redis).toHaveBeenCalledWith('SCAN', '0', 'MATCH', 'user:*', 'COUNT', '500');
    expect(redis).toHaveBeenCalledWith('DEL', 'k1', 'k2');
    expect(redis).toHaveBeenCalledWith('SCAN', '1', 'MATCH', 'user:*', 'COUNT', '500');
    expect(redis).toHaveBeenCalledWith('DEL', 'k3');
  });

  it('blocks wildcard clear in production', async () => {
    process.env['NODE_ENV'] = 'production';

    const redis = vi.fn();
    const databaseMock: IDatabaseService = {
      config: {
        type: 'redis',
        connection: 'redis://localhost:6379',
      },
      init: async () => undefined,
      query: async <T>() => [] as unknown as T,
      getClient: async () => ({}),
      redis,
      close: async () => undefined,
    };

    const service = new CacheService(databaseMock);

    await expect(service.clear('*')).rejects.toThrow(
      'cache.clear("*") is disabled in production for safety'
    );
    expect(redis).not.toHaveBeenCalled();
  });
});
