import type { IDatabaseService, DatabaseConfig } from '../types.js';

/**
 * Database service implementation
 * Singleton wrapper for database connection pools
 */
type RedisArg = string | number | Buffer;

interface DatabaseAdapter {
  init(config: DatabaseConfig): Promise<unknown>;
  query<T = unknown>(pool: unknown, sql: string, params?: unknown[]): Promise<T>;
  getClient(pool: unknown): Promise<unknown>;
  close(pool: unknown): Promise<void>;
  redis?(pool: unknown, args: RedisArg[]): Promise<unknown>;
}

class PostgresAdapter implements DatabaseAdapter {
  public async init(config: DatabaseConfig): Promise<unknown> {
    // @ts-expect-error - pg is an optional peer dependency
    const { Pool } = await import('pg');

    if (typeof config.connection === 'string') {
      const pool = new Pool({ connectionString: config.connection });
      await pool.query('SELECT 1');
      return pool;
    }

    const conn = config.connection;
    if (!('host' in conn) || !('database' in conn) || !('user' in conn) || !('password' in conn)) {
      throw new Error('PostgreSQL connection requires host, database, user, and password');
    }

    const pool = new Pool({
      host: conn.host,
      port: conn.port ?? 5432,
      database: conn.database,
      user: conn.user,
      password: conn.password,
      ssl: 'ssl' in conn ? conn.ssl : undefined,
      max: config.pool?.max ?? 10,
      min: config.pool?.min ?? 2,
      idleTimeoutMillis: config.pool?.idleTimeoutMillis ?? 30000,
      connectionTimeoutMillis: config.pool?.connectionTimeoutMillis ?? 30000,
    });

    await pool.query('SELECT 1');
    return pool;
  }

  public async query<T = unknown>(pool: unknown, sql: string, params?: unknown[]): Promise<T> {
    const pgPool = pool as {
      query: (text: string, values?: unknown[]) => Promise<{ rows: T }>;
    };
    const result = await pgPool.query(sql, params);
    return result.rows as T;
  }

  public async getClient(pool: unknown): Promise<unknown> {
    const pgPool = pool as { connect: () => Promise<unknown> };
    return await pgPool.connect();
  }

  public async close(pool: unknown): Promise<void> {
    const pgPool = pool as { end: () => Promise<void> };
    await pgPool.end();
  }
}

class MySQLAdapter implements DatabaseAdapter {
  public async init(config: DatabaseConfig): Promise<unknown> {
    // @ts-expect-error - mysql2 is an optional peer dependency
    const mysql = await import('mysql2/promise');

    if (typeof config.connection === 'string') {
      const pool = mysql.createPool({
        uri: config.connection,
        waitForConnections: true,
        connectionLimit: config.pool?.max ?? 10,
        queueLimit: 0,
      });
      await pool.query('SELECT 1');
      return pool;
    }

    const conn = config.connection;
    if (!('host' in conn) || !('database' in conn) || !('user' in conn) || !('password' in conn)) {
      throw new Error('MySQL connection requires host, database, user, and password');
    }

    const pool = mysql.createPool({
      host: conn.host,
      port: conn.port ?? 3306,
      database: conn.database,
      user: conn.user,
      password: conn.password,
      ssl: 'ssl' in conn ? conn.ssl : undefined,
      waitForConnections: true,
      connectionLimit: config.pool?.max ?? 10,
      queueLimit: 0,
    });

    await pool.query('SELECT 1');
    return pool;
  }

  public async query<T = unknown>(pool: unknown, sql: string, params?: unknown[]): Promise<T> {
    const mySqlPool = pool as {
      execute: (queryText: string, values?: unknown[]) => Promise<[T, unknown]>;
    };
    const [rows] = await mySqlPool.execute(sql, params);
    return rows;
  }

  public async getClient(pool: unknown): Promise<unknown> {
    const mySqlPool = pool as { getConnection: () => Promise<unknown> };
    return await mySqlPool.getConnection();
  }

  public async close(pool: unknown): Promise<void> {
    const mySqlPool = pool as { end: () => Promise<void> };
    await mySqlPool.end();
  }
}

class MongoAdapter implements DatabaseAdapter {
  public async init(config: DatabaseConfig): Promise<unknown> {
    // @ts-expect-error - mongodb is an optional peer dependency
    const { MongoClient } = await import('mongodb');

    let uri: string;
    if (typeof config.connection === 'string') {
      uri = config.connection;
    } else {
      const conn = config.connection;
      if (!('database' in conn)) {
        throw new Error('MongoDB connection requires a "database" property');
      }
      const auth = conn.user && conn.password ? `${conn.user}:${conn.password}@` : '';
      uri = `mongodb://${auth}${conn.host}:${conn.port ?? 27017}/${conn.database}`;
    }

    const client = new MongoClient(uri);
    await client.connect();
    return client;
  }

  public async query<T = unknown>(_pool: unknown, _sql: string, _params?: unknown[]): Promise<T> {
    throw new Error('Use getClient() for MongoDB operations');
  }

  public async getClient(pool: unknown): Promise<unknown> {
    return pool;
  }

  public async close(pool: unknown): Promise<void> {
    const client = pool as { close: () => Promise<void> };
    await client.close();
  }
}

class RedisAdapter implements DatabaseAdapter {
  public async init(config: DatabaseConfig): Promise<unknown> {
    // @ts-expect-error - redis is an optional peer dependency
    const { createClient } = await import('redis');

    if (typeof config.connection === 'string') {
      const client = createClient({ url: config.connection });
      await client.connect();
      await client.ping();
      return client;
    }

    const conn = config.connection as {
      host: string;
      port?: number;
      password?: string;
      db?: number;
      tls?: boolean;
    };
    const protocol = conn.tls ? 'rediss' : 'redis';
    const auth = conn.password ? `:${conn.password}@` : '';
    const database = conn.db !== undefined ? `/${conn.db}` : '';
    const url = `${protocol}://${auth}${conn.host}:${conn.port ?? 6379}${database}`;

    const client = createClient({ url });
    await client.connect();
    await client.ping();
    return client;
  }

  public async query<T = unknown>(_pool: unknown, _sql: string, _params?: unknown[]): Promise<T> {
    throw new Error('Use redis() method for Redis operations');
  }

  public async getClient(pool: unknown): Promise<unknown> {
    return pool;
  }

  public async close(pool: unknown): Promise<void> {
    const client = pool as { quit: () => Promise<void> };
    await client.quit();
  }

  public async redis(pool: unknown, args: RedisArg[]): Promise<unknown> {
    const client = pool as { sendCommand: (commandArgs: RedisArg[]) => Promise<unknown> };
    return await client.sendCommand(args);
  }
}

export class DatabaseService implements IDatabaseService {
  private pool: unknown;
  public readonly config: DatabaseConfig;
  private initialized = false;
  private adapter: DatabaseAdapter | null = null;

  constructor(config: DatabaseConfig) {
    this.config = config;
  }

  /**
   * Initialize the database connection pool
   */
  public async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      this.adapter = this.createAdapter(this.config.type);
      this.pool = await this.adapter.init(this.config);

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private createAdapter(type: DatabaseConfig['type']): DatabaseAdapter {
    switch (type) {
      case 'postgresql':
        return new PostgresAdapter();
      case 'mysql':
        return new MySQLAdapter();
      case 'mongodb':
        return new MongoAdapter();
      case 'redis':
        return new RedisAdapter();
      default:
        throw new Error(`Unsupported database type: ${type}`);
    }
  }

  /**
   * Execute a database query
   */
  public async query<T = unknown>(sql: string, params?: unknown[]): Promise<T> {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call init() first.');
    }

    try {
      return await this.adapter!.query<T>(this.pool, sql, params);
    } catch (error) {
      throw new Error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get a database client from the pool
   */
  public async getClient(): Promise<unknown> {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call init() first.');
    }

    return await this.adapter!.getClient(this.pool);
  }

  /**
   * Execute Redis commands
   * Use this for Redis-specific operations
   *
   * @example
   * await db.redis('SET', 'key', 'value', 'EX', 3600);
   * const value = await db.redis('GET', 'key');
   */
  public async redis(...args: (string | number | Buffer)[]): Promise<unknown> {
    if (!this.initialized) {
      throw new Error('Database not initialized. Call init() first.');
    }

    if (this.config.type !== 'redis') {
      throw new Error('redis() method is only available for Redis connections');
    }

    if (!this.adapter?.redis) {
      throw new Error('Redis adapter does not support redis() commands');
    }

    try {
      return await this.adapter.redis(this.pool, args);
    } catch (error) {
      throw new Error(
        `Redis command failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Close all database connections
   */
  public async close(): Promise<void> {
    if (!this.initialized || !this.pool) {
      return;
    }

    try {
      await this.adapter!.close(this.pool);

      this.initialized = false;
      this.pool = undefined;
      this.adapter = null;
    } catch (error) {
      throw new Error(
        `Failed to close database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
