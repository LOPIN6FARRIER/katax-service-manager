import type { IDatabaseService } from '../types.js';

/**
 * Cache service implementation using Redis
 * Provides high-level cache operations with automatic JSON serialization
 */
export class CacheService {
  constructor(private readonly redis: IDatabaseService) {
    if (redis.config?.type !== 'redis') {
      throw new Error('CacheService requires a Redis database connection');
    }
    if (!redis.redis) {
      throw new Error('Redis connection does not support redis() method');
    }
  }

  /**
   * Get a value from cache
   * Automatically deserializes JSON
   *
   * @example
   * const user = await cache.get<User>('user:123');
   */
  public async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const value = await this.redis.redis!('GET', key);
      if (!value) {
        return null;
      }
      return JSON.parse(value as string) as T;
    } catch (error) {
      throw new Error(
        `Cache get failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Set a value in cache with optional TTL (time-to-live in seconds)
   * Automatically serializes to JSON
   *
   * @example
   * await cache.set('user:123', user, 3600); // Expires in 1 hour
   * await cache.set('config', config); // No expiration
   */
  public async set(key: string, value: unknown, ttl?: number): Promise<void> {
    try {
      const serialized = JSON.stringify(value);
      if (ttl) {
        await this.redis.redis!('SET', key, serialized, 'EX', ttl);
      } else {
        await this.redis.redis!('SET', key, serialized);
      }
    } catch (error) {
      throw new Error(
        `Cache set failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete a key from cache
   *
   * @example
   * await cache.del('user:123');
   */
  public async del(key: string): Promise<void> {
    try {
      await this.redis.redis!('DEL', key);
    } catch (error) {
      throw new Error(
        `Cache del failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Delete multiple keys from cache
   *
   * @example
   * await cache.delMany(['user:123', 'user:456']);
   */
  public async delMany(keys: string[]): Promise<void> {
    if (keys.length === 0) return;

    try {
      await this.redis.redis!('DEL', ...keys);
    } catch (error) {
      throw new Error(
        `Cache delMany failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Check if a key exists in cache
   *
   * @example
   * if (await cache.exists('user:123')) { ... }
   */
  public async exists(key: string): Promise<boolean> {
    try {
      const result = await this.redis.redis!('EXISTS', key);
      return result === 1;
    } catch (error) {
      throw new Error(
        `Cache exists failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get remaining TTL (time-to-live) in seconds
   * Returns -1 if key exists but has no expiration
   * Returns -2 if key does not exist
   *
   * @example
   * const ttl = await cache.ttl('user:123');
   * console.log(`Expires in ${ttl} seconds`);
   */
  public async ttl(key: string): Promise<number> {
    try {
      const result = await this.redis.redis!('TTL', key);
      return result as number;
    } catch (error) {
      throw new Error(
        `Cache ttl failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Set expiration time for a key (in seconds)
   *
   * @example
   * await cache.expire('user:123', 3600); // Expire in 1 hour
   */
  public async expire(key: string, seconds: number): Promise<boolean> {
    try {
      const result = await this.redis.redis!('EXPIRE', key, seconds);
      return result === 1;
    } catch (error) {
      throw new Error(
        `Cache expire failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Increment a numeric value
   * Creates key with value 0 if it doesn't exist
   *
   * @example
   * await cache.incr('page:views'); // Returns new value
   */
  public async incr(key: string): Promise<number> {
    try {
      const result = await this.redis.redis!('INCR', key);
      return result as number;
    } catch (error) {
      throw new Error(
        `Cache incr failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Increment a numeric value by a specific amount
   *
   * @example
   * await cache.incrBy('page:views', 10);
   */
  public async incrBy(key: string, increment: number): Promise<number> {
    try {
      const result = await this.redis.redis!('INCRBY', key, increment);
      return result as number;
    } catch (error) {
      throw new Error(
        `Cache incrBy failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Decrement a numeric value
   *
   * @example
   * await cache.decr('available:seats');
   */
  public async decr(key: string): Promise<number> {
    try {
      const result = await this.redis.redis!('DECR', key);
      return result as number;
    } catch (error) {
      throw new Error(
        `Cache decr failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get multiple values at once
   * Returns array with null for missing keys
   *
   * @example
   * const [user1, user2] = await cache.mget<User>(['user:1', 'user:2']);
   */
  public async mget<T = unknown>(keys: string[]): Promise<(T | null)[]> {
    if (keys.length === 0) return [];

    try {
      const values = (await this.redis.redis!('MGET', ...keys)) as (string | null)[];
      return values.map((v) => (v ? (JSON.parse(v) as T) : null));
    } catch (error) {
      throw new Error(
        `Cache mget failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Set multiple key-value pairs at once
   * Note: Does not support TTL, use set() for that
   *
   * @example
   * await cache.mset([
   *   ['user:1', user1],
   *   ['user:2', user2]
   * ]);
   */
  public async mset(entries: [string, unknown][]): Promise<void> {
    if (entries.length === 0) return;

    try {
      const args: (string | number | Buffer)[] = [];
      for (const [key, value] of entries) {
        args.push(key, JSON.stringify(value));
      }
      await this.redis.redis!('MSET', ...args);
    } catch (error) {
      throw new Error(
        `Cache mset failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Clear all keys matching a pattern
   * ⚠️ Use with caution in production
   *
   * @example
   * await cache.clear('user:*'); // Clear all user keys
   * await cache.clear('session:*'); // Clear all sessions
   */
  public async clear(pattern: string = '*'): Promise<number> {
    try {
      const isProd = process.env['NODE_ENV']?.toLowerCase() === 'production';
      if (isProd && pattern === '*') {
        throw new Error('cache.clear("*") is disabled in production for safety');
      }

      let deleted = 0;
      let cursor = '0';

      do {
        const result = (await this.redis.redis!(
          'SCAN',
          cursor,
          'MATCH',
          pattern,
          'COUNT',
          '500'
        )) as [string, string[]];

        cursor = result[0] ?? '0';
        const keys = result[1] ?? [];

        if (keys.length > 0) {
          await this.redis.redis!('DEL', ...keys);
          deleted += keys.length;
        }
      } while (cursor !== '0');

      return deleted;
    } catch (error) {
      throw new Error(
        `Cache clear failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get cache statistics
   *
   * @example
   * const stats = await cache.stats();
   * console.log(`Connected clients: ${stats.connected_clients}`);
   */
  public async stats(): Promise<Record<string, string>> {
    try {
      const info = (await this.redis.redis!('INFO', 'stats')) as string;
      const stats: Record<string, string> = {};

      for (const line of info.split('\n')) {
        const [key, value] = line.split(':');
        if (key && value) {
          stats[key.trim()] = value.trim();
        }
      }

      return stats;
    } catch (error) {
      throw new Error(
        `Cache stats failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
