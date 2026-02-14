import type { IDatabaseService, DatabaseConfig } from '../types.js';

/**
 * Database service implementation
 * Singleton wrapper for database connection pools
 */
export class DatabaseService implements IDatabaseService {
  private pool: unknown;
  public readonly config: DatabaseConfig;
  private initialized = false;

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
      switch (this.config.type) {
        case 'postgresql':
          await this.initPostgreSQL();
          break;
        case 'mysql':
          await this.initMySQL();
          break;
        case 'mongodb':
          await this.initMongoDB();
          break;
        case 'redis':
          await this.initRedis();
          break;
        default:
          throw new Error(`Unsupported database type: ${this.config.type}`);
      }

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Initialize PostgreSQL connection pool
   */
  private async initPostgreSQL(): Promise<void> {
    try {
      // @ts-expect-error - pg is an optional peer dependency
      const { Pool } = await import('pg');

      if (typeof this.config.connection === 'string') {
        this.pool = new Pool({ connectionString: this.config.connection });
      } else {
        const conn = this.config.connection;
        // Validate required PostgreSQL connection properties
        if (
          !('host' in conn) ||
          !('database' in conn) ||
          !('user' in conn) ||
          !('password' in conn)
        ) {
          throw new Error('PostgreSQL connection requires host, database, user, and password');
        }
        this.pool = new Pool({
          host: conn.host,
          port: conn.port ?? 5432,
          database: conn.database,
          user: conn.user,
          password: conn.password,
          ssl: 'ssl' in conn ? conn.ssl : undefined,
          max: this.config.pool?.max ?? 10,
          min: this.config.pool?.min ?? 2,
          idleTimeoutMillis: this.config.pool?.idleTimeoutMillis ?? 30000,
          connectionTimeoutMillis: this.config.pool?.connectionTimeoutMillis ?? 30000,
        });
      }

      // Test connection
      const pool = this.pool as { query: (text: string) => Promise<unknown> };
      await pool.query('SELECT 1');
    } catch (error) {
      throw new Error(
        `PostgreSQL initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Initialize MySQL connection pool
   */
  private async initMySQL(): Promise<void> {
    try {
      // @ts-expect-error - mysql2 is an optional peer dependency
      const mysql = await import('mysql2/promise');

      if (typeof this.config.connection === 'string') {
        this.pool = mysql.createPool({
          uri: this.config.connection,
          waitForConnections: true,
          connectionLimit: this.config.pool?.max ?? 10,
          queueLimit: 0,
        });
      } else {
        const conn = this.config.connection;
        // Validate required MySQL connection properties
        if (
          !('host' in conn) ||
          !('database' in conn) ||
          !('user' in conn) ||
          !('password' in conn)
        ) {
          throw new Error('MySQL connection requires host, database, user, and password');
        }
        this.pool = mysql.createPool({
          host: conn.host,
          port: conn.port ?? 3306,
          database: conn.database,
          user: conn.user,
          password: conn.password,
          ssl: 'ssl' in conn ? conn.ssl : undefined,
          waitForConnections: true,
          connectionLimit: this.config.pool?.max ?? 10,
          queueLimit: 0,
        });
      }

      // Test connection
      const pool = this.pool as { query: (sql: string) => Promise<unknown> };
      await pool.query('SELECT 1');
    } catch (error) {
      throw new Error(
        `MySQL initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Initialize MongoDB connection
   */
  private async initMongoDB(): Promise<void> {
    try {
      // @ts-expect-error - mongodb is an optional peer dependency
      const { MongoClient } = await import('mongodb');

      let uri: string;
      if (typeof this.config.connection === 'string') {
        uri = this.config.connection;
      } else {
        const conn = this.config.connection;
        // Validate MongoDB connection options
        if (!('database' in conn)) {
          throw new Error('MongoDB connection requires a "database" property');
        }
        const auth = conn.user && conn.password ? `${conn.user}:${conn.password}@` : '';
        uri = `mongodb://${auth}${conn.host}:${conn.port ?? 27017}/${conn.database}`;
      }

      const client = new MongoClient(uri);
      await client.connect();
      this.pool = client;
    } catch (error) {
      throw new Error(
        `MongoDB initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Initialize Redis connection
   */
  private async initRedis(): Promise<void> {
    try {
      // @ts-expect-error - redis is an optional peer dependency
      const { createClient } = await import('redis');

      if (typeof this.config.connection === 'string') {
        const client = createClient({ url: this.config.connection });
        await client.connect();
        this.pool = client;
      } else {
        const conn = this.config.connection as {
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
        this.pool = client;
      }

      // Test connection
      const client = this.pool as { ping: () => Promise<string> };
      await client.ping();
    } catch (error) {
      throw new Error(
        `Redis initialization failed: ${error instanceof Error ? error.message : String(error)}`
      );
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
      switch (this.config.type) {
        case 'postgresql': {
          const pool = this.pool as {
            query: (text: string, values?: unknown[]) => Promise<{ rows: T }>;
          };
          const result = await pool.query(sql, params);
          return result.rows as T;
        }
        case 'mysql': {
          const pool = this.pool as {
            execute: (sql: string, values?: unknown[]) => Promise<[T, unknown]>;
          };
          const [rows] = await pool.execute(sql, params);
          return rows;
        }
        case 'mongodb':
          throw new Error('Use getClient() for MongoDB operations');
        case 'redis':
          throw new Error('Use redis() method for Redis operations');
        default:
          throw new Error(`Unsupported database type: ${this.config.type}`);
      }
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

    switch (this.config.type) {
      case 'postgresql': {
        const pool = this.pool as { connect: () => Promise<unknown> };
        return await pool.connect();
      }
      case 'mysql': {
        const pool = this.pool as { getConnection: () => Promise<unknown> };
        return await pool.getConnection();
      }
      case 'mongodb':
        return this.pool;
      case 'redis':
        return this.pool;
      default:
        throw new Error(`Unsupported database type: ${this.config.type}`);
    }
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

    try {
      const client = this.pool as {
        sendCommand: (args: (string | number | Buffer)[]) => Promise<unknown>;
      };
      return await client.sendCommand(args);
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
      switch (this.config.type) {
        case 'postgresql': {
          const pool = this.pool as { end: () => Promise<void> };
          await pool.end();
          break;
        }
        case 'mysql': {
          const pool = this.pool as { end: () => Promise<void> };
          await pool.end();
          break;
        }
        case 'mongodb': {
          const client = this.pool as { close: () => Promise<void> };
          await client.close();
          break;
        }
        case 'redis': {
          const client = this.pool as { quit: () => Promise<void> };
          await client.quit();
          break;
        }
      }

      this.initialized = false;
      this.pool = undefined;
    } catch (error) {
      throw new Error(
        `Failed to close database: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
