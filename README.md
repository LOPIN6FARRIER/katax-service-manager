# Katax Service Manager

[![npm version](https://img.shields.io/npm/v/katax-service-manager.svg)](https://www.npmjs.com/package/katax-service-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

🚀 **Runtime service container for Node.js applications** - Manages shared services like config, logging, database pools, caching, and WebSocket connections with a singleton pattern.

## Features

- ✅ **Singleton Pattern** - One Katax instance, but multiple databases/services
- 🔧 **Configuration Service** - Unified config from .env, package.json, and custom sources
- 📝 **Logger Service** - Pino-based structured logging with WebSocket broadcast
- 💾 **Database Service** - Connection pools for PostgreSQL, MySQL, MongoDB, and Redis
- 🚀 **Cache Service** - High-level Redis cache API with automatic JSON serialization
- ⏰ **Cron Service** - Scheduled jobs with dynamic management
- 🔌 **WebSocket Service** - Socket.IO for real-time communication
- 🔄 **Multi-Instance** - Connect to multiple databases/WebSockets simultaneously
- 🛡️ **Type-Safe** - Full TypeScript support with strict mode
- 🎯 **Dynamic Creation** - Create services on-demand, no init() required

---

## Table of Contents

- [Installation](#installation)
- [Quick Start](#quick-start)
- [Core Concepts](#core-concepts)
- [Configuration Service](#configuration-service)
- [Logger Service](#logger-service)
- [Database Service](#database-service)
  - [PostgreSQL](#postgresql)
  - [MySQL](#mysql)
  - [MongoDB](#mongodb)
  - [Redis](#redis)
- [Cache Service](#cache-service)
- [Cron Service](#cron-service)
- [WebSocket Service](#websocket-service)
- [Common Patterns](#common-patterns)
- [Best Practices](#best-practices)
- [API Reference](#api-reference)
- [License](#license)

---

## Installation

```bash
npm install katax-service-manager
```

### Optional peer dependencies (install what you need):

```bash
# PostgreSQL
npm install pg

# MySQL  
npm install mysql2

# MongoDB
npm install mongodb

# Redis (cache, sessions, pub/sub)
npm install redis

# WebSocket (real-time communication)
npm install socket.io
```

---

## Quick Start

```typescript
import { Katax } from 'katax-service-manager';

const katax = Katax.getInstance();

// Create database connection
const db = await katax.database({
  name: 'postgres',
  type: 'postgresql',
  connection: {
    host: 'localhost',
    user: 'admin',
    password: 'secret',
    database: 'myapp',
    port: 5432
  },
  pool: {
    max: 20,
    min: 5,
    idleTimeoutMillis: 30000
  }
});

// Query database
const users = await db.query('SELECT * FROM users WHERE active = $1', [true]);

// Use logger
katax.logger.info({ message: 'App started', users: users.length });

// Graceful shutdown
process.on('SIGTERM', async () => {
  await katax.shutdown();
  process.exit(0);
});
```

---

## Core Concepts

### 1. Dynamic Service Creation

No need for `init()` - create services when you need them:

```typescript
const katax = Katax.getInstance();

// Create multiple database connections
const postgres = await katax.database({
  name: 'main',
  type: 'postgresql',
  connection: { host: 'localhost', database: 'main' }
});

const mongo = await katax.database({
  name: 'analytics',
  type: 'mongodb',
  connection: { host: 'localhost', database: 'analytics' }
});

const redis = await katax.database({
  name: 'cache',
  type: 'redis',
  connection: { host: 'localhost' }
});
```

### 2. Automatic Instance Reuse

Requesting the same connection by name returns the existing instance:

```typescript
// First call - creates connection
const db1 = await katax.database({ name: 'main', type: 'postgresql', ... });

// Second call - returns same connection (no new connection created)
const db2 = await katax.database({ name: 'main', type: 'postgresql', ... });

console.log(db1 === db2); // true - same instance
```

### 3. Graceful Shutdown

Always close connections properly:

```typescript
// Closes all databases, websockets, and stops cron jobs
await katax.shutdown();
```

---

## Configuration Service

Unified configuration from multiple sources:

```typescript
const katax = Katax.getInstance();

// Get config values with defaults
const port = katax.config.get('PORT', 3000);
const dbHost = katax.config.get('DB_HOST', 'localhost');
const apiKey = katax.config.get('API_KEY'); // undefined if not set

// Get all config
const allConfig = katax.config.getAll();

// Check if config exists
const hasKey = katax.config.has('API_KEY');
```

**Configuration sources** (in order of priority):
1. Environment variables (`.env`)
2. `package.json` custom fields
3. Default values provided in code

---

## Logger Service

Pino-based structured logging with WebSocket broadcast support:

```typescript
const katax = Katax.getInstance();

// Simple logging
katax.logger.info({ message: 'Server started' });
katax.logger.error({ message: 'Database connection failed', error: err.message });
katax.logger.warn({ message: 'High memory usage', percent: 85 });

// With context
katax.logger.info({ 
  message: 'User logged in',
  userId: 123,
  ip: '192.168.1.1'
});

// Broadcast to WebSocket (if configured)
katax.logger.info({ 
  message: 'Critical event',
  broadcast: true // Will emit to connected WebSocket clients
});
```

**Log Levels**: `info`, `error`, `warn`, `debug`, `fatal`

**Configuration**:
```typescript
// Logger is always available, no setup needed
// Logs to stdout by default
```

---

## Database Service

### PostgreSQL

```typescript
const pg = await katax.database({
  name: 'main',
  type: 'postgresql',
  connection: {
    host: 'localhost',
    port: 5432,
    user: 'admin',
    password: 'secret',
    database: 'myapp'
  },
  pool: {
    max: 20,           // Maximum connections
    min: 5,            // Minimum connections
    idleTimeoutMillis: 30000
  }
});

// Parameterized queries (prevents SQL injection)
const users = await pg.query('SELECT * FROM users WHERE id = $1', [userId]);

// Transactions
const client = await pg.getClient();
try {
  await client.query('BEGIN');
  await client.query('UPDATE accounts SET balance = balance - $1 WHERE id = $2', [100, 1]);
  await client.query('UPDATE accounts SET balance = balance + $1 WHERE id = $2', [100, 2]);
  await client.query('COMMIT');
} catch (e) {
  await client.query('ROLLBACK');
  throw e;
} finally {
  client.release();
}
```

### MySQL

```typescript
const mysql = await katax.database({
  name: 'legacy',
  type: 'mysql',
  connection: {
    host: 'localhost',
    port: 3306,
    user: 'root',
    password: 'secret',
    database: 'legacy_db'
  },
  pool: {
    max: 10,
    min: 2,
    idleTimeoutMillis: 30000
  }
});

// Parameterized queries
const products = await mysql.query('SELECT * FROM products WHERE category = ?', ['electronics']);
```

### MongoDB

```typescript
const mongo = await katax.database({
  name: 'analytics',
  type: 'mongodb',
  connection: {
    host: 'localhost',
    port: 27017,
    user: 'admin',
    password: 'secret',
    database: 'analytics'
  }
});

// Get MongoDB client
const client = await mongo.getClient();
const db = client.db();

// Collections
const events = db.collection('events');
await events.insertOne({ userId: 123, event: 'login', timestamp: new Date() });
const userEvents = await events.find({ userId: 123 }).toArray();
```

### Redis

#### Connection Options

```typescript
const redis = await katax.database({
  name: 'cache',
  type: 'redis',
  connection: {
    host: 'localhost',
    port: 6379,          // Optional, default: 6379
    password: 'secret',   // Optional
    db: 0,               // Optional, database number (0-15)
    tls: {               // Optional, for production
      rejectUnauthorized: true
    }
  }
});

// Or use connection string
const redis2 = await katax.database({
  name: 'sessions',
  type: 'redis',
  connection: 'redis://:password@localhost:6379/1'
});
```

#### Low-Level Redis Commands

```typescript
// Execute any Redis command
await redis.redis('SET', 'key', 'value', 'EX', '60');
const value = await redis.redis('GET', 'key');

// Counters
await redis.redis('INCR', 'page-views');

// Lists
await redis.redis('LPUSH', 'queue', 'job1');
await redis.redis('RPOP', 'queue');

// Pub/Sub
await redis.redis('PUBLISH', 'notifications', JSON.stringify({ msg: 'Hello' }));

// Hashes
await redis.redis('HSET', 'user:123', 'name', 'John', 'age', '30');
```

---

## Cache Service

High-level Redis wrapper with automatic JSON serialization:

### Basic Operations

```typescript
const cache = katax.cache('cache'); // Uses Redis connection named 'cache'

// Set with TTL (time-to-live in seconds)
await cache.set('user:123', { id: 123, name: 'John', email: 'john@example.com' }, 3600);

// Set without TTL (permanent)
await cache.set('config', { theme: 'dark', lang: 'en' });

// Get (type-safe with generics)
const user = await cache.get<User>('user:123'); // Returns User | null

// Delete single key
await cache.del('user:123');

// Delete multiple keys
const deleted = await cache.delMany(['key1', 'key2', 'key3']);
console.log(`Deleted ${deleted} keys`);

// Check existence
const exists = await cache.exists('user:123'); // boolean

// Get TTL
const ttl = await cache.ttl('user:123'); // seconds (-1 = no expiration, -2 = doesn't exist)

// Set expiration on existing key
await cache.expire('user:123', 300); // 5 minutes
```

### Batch Operations

```typescript
// Set multiple keys at once
await cache.mset({
  'product:1': { id: 1, name: 'Laptop', price: 999 },
  'product:2': { id: 2, name: 'Mouse', price: 29 }
});

// Get multiple keys at once
const products = await cache.mget<Product>(['product:1', 'product:2']);
// Returns: (Product | null)[]
```

### Counter Operations

```typescript
// Increment (creates key if doesn't exist, starts at 0)
await cache.incr('page-views'); // Returns new value

// Increment by specific amount
await cache.incrBy('page-views', 10);

// Decrement
await cache.decr('page-views');
```

### Pattern-Based Operations

⚠️ **Use with caution in production!**

```typescript
// Delete all keys matching pattern
await cache.clear('temp:*');
await cache.clear('user:session:*');

// Clear entire cache (dangerous!)
await cache.clear('*');
```

### Cache Statistics

```typescript
const stats = await cache.stats();
console.log(stats);
// Example output:
// {
//   uptime: 3600,
//   connected_clients: 5,
//   used_memory: '1048576',
//   used_memory_human: '1M',
//   total_commands_processed: 12345
// }
```

---

## Cron Service

Scheduled jobs with dynamic management:

```typescript
const katax = Katax.getInstance();

// Add a cron job
katax.cron({
  name: 'cleanup',
  schedule: '0 0 * * *', // Every day at midnight (cron expression)
  task: async () => {
    katax.logger.info({ message: 'Running cleanup...' });
    await cleanupOldData();
  },
  enabled: () => process.env.NODE_ENV === 'production', // Optional condition
  runOnInit: false // Optional, run immediately on start
});

// Add another job
katax.cron({
  name: 'send-emails',
  schedule: '*/5 * * * *', // Every 5 minutes
  task: async () => {
    await sendPendingEmails();
  }
});

// Cron expressions:
// '* * * * *'     - Every minute
// '0 * * * *'     - Every hour
// '0 0 * * *'     - Every day at midnight
// '0 0 * * 0'     - Every Sunday at midnight
// '*/5 * * * *'   - Every 5 minutes
// '0 9-17 * * 1-5' - Every hour from 9am to 5pm, Monday to Friday
```

---

## WebSocket Service

Real-time communication with Socket.IO:

```typescript
const ws = await katax.socket({
  name: 'main',
  port: 3001,
  path: '/ws'
});

// Broadcast to all clients
ws.emit('notification', { message: 'New update available' });

// Emit to specific room
ws.emitToRoom('room1', 'message', { text: 'Hello room!' });

// Listen for events from clients (optional - use sparingly)
ws.on('client-message', (data) => {
  katax.logger.info({ message: 'Received from client', data });
});

// Multiple WebSocket servers
const dashboardWs = await katax.socket({
  name: 'dashboard',
  port: 3002,
  path: '/dashboard'
});

const metricsWs = await katax.socket({
  name: 'metrics',
  port: 3003,
  path: '/metrics'
});
```

**Client-side example**:
```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:3001', { path: '/ws' });

socket.on('notification', (data) => {
  console.log('Notification:', data);
});
```

---

## Common Patterns

### 1. Cache-Aside Pattern

```typescript
async function getUserById(userId: number): Promise<User> {
  const cache = katax.cache('cache');
  const cacheKey = `user:${userId}`;
  
  // Try cache first
  const cached = await cache.get<User>(cacheKey);
  if (cached) {
    return cached; // Cache hit
  }
  
  // Cache miss - fetch from database
  const db = await katax.database({ name: 'main', type: 'postgresql', ... });
  const user = await db.query<User>('SELECT * FROM users WHERE id = $1', [userId]);
  
  // Store in cache for next time (5 minutes TTL)
  await cache.set(cacheKey, user, 300);
  
  return user;
}
```

### 2. Rate Limiting

```typescript
async function checkRateLimit(userId: number, maxRequests: number = 100): Promise<boolean> {
  const cache = katax.cache('cache');
  const key = `rate-limit:user:${userId}`;
  
  const current = await cache.incrBy(key, 1);
  
  if (current === 1) {
    // First request in this window - set expiration (60 seconds)
    await cache.expire(key, 60);
  }
  
  return current <= maxRequests;
}

// Usage in Express middleware
app.use(async (req, res, next) => {
  const userId = req.user?.id;
  if (!userId) return next();
  
  if (!await checkRateLimit(userId, 100)) {
    return res.status(429).json({ error: 'Rate limit exceeded' });
  }
  
  next();
});
```

### 3. Session Storage

```typescript
interface Session {
  userId: number;
  token: string;
  expires: number;
}

async function createSession(userId: number): Promise<string> {
  const cache = katax.cache('sessions');
  const token = generateRandomToken();
  
  const session: Session = {
    userId,
    token,
    expires: Date.now() + 3600000 // 1 hour
  };
  
  await cache.set(`session:${token}`, session, 3600);
  return token;
}

async function getSession(token: string): Promise<Session | null> {
  const cache = katax.cache('sessions');
  return await cache.get<Session>(`session:${token}`);
}

async function destroySession(token: string): Promise<void> {
  const cache = katax.cache('sessions');
  await cache.del(`session:${token}`);
}
```

### 4. Multiple Databases

```typescript
// E-commerce app with multiple data stores
const postgres = await katax.database({
  name: 'main',
  type: 'postgresql',
  connection: { database: 'ecommerce' }
});

const mongo = await katax.database({
  name: 'analytics',
  type: 'mongodb',
  connection: { database: 'analytics' }
});

const redis = await katax.database({
  name: 'cache',
  type: 'redis',
  connection: { host: 'localhost' }
});

// Use them independently
const products = await postgres.query('SELECT * FROM products');
await mongo.getClient().db().collection('events').insertOne({ event: 'page_view' });
await redis.redis('INCR', 'page-views');
```

### 5. Distributed Lock

```typescript
async function acquireLock(resource: string, ttl: number = 10): Promise<boolean> {
  const redis = await katax.database({ name: 'cache', type: 'redis', ... });
  const key = `lock:${resource}`;
  
  // SET NX (set if not exists) with expiration
  const result = await redis.redis('SET', key, '1', 'NX', 'EX', ttl.toString());
  return result === 'OK';
}

async function releaseLock(resource: string): Promise<void> {
  const cache = katax.cache('cache');
  await cache.del(`lock:${resource}`);
}

// Usage
async function criticalSection() {
  if (!await acquireLock('critical-resource')) {
    throw new Error('Resource locked');
  }
  
  try {
    // Do critical work
    await performCriticalOperation();
  } finally {
    await releaseLock('critical-resource');
  }
}
```

---

## Best Practices

### 1. Always Use Connection Pooling

```typescript
// ✅ Good - Connection pooling configured
const db = await katax.database({
  name: 'main',
  type: 'postgresql',
  connection: { ... },
  pool: {
    max: 20,
    min: 5,
    idleTimeoutMillis: 30000
  }
});
```

### 2. Use Parameterized Queries

```typescript
// ✅ Good - Safe from SQL injection
const users = await db.query('SELECT * FROM users WHERE email = $1', [email]);

// ❌ Bad - SQL injection vulnerability
const users = await db.query(`SELECT * FROM users WHERE email = '${email}'`);
```

### 3. Set TTL on Cache Keys

```typescript
// ✅ Good - Has expiration
await cache.set('user:123', user, 3600);

// ⚠️ Careful - No expiration (can cause memory issues)
await cache.set('permanent-data', data);
```

### 4. Use Meaningful Key Prefixes

```typescript
// ✅ Good - Clear hierarchy
await cache.set('user:123:profile', profile);
await cache.set('user:123:settings', settings);
await cache.set('product:456:details', product);

// ❌ Bad - No structure
await cache.set('123', profile);
await cache.set('prod456', product);
```

### 5. Handle Errors Gracefully

```typescript
try {
  const user = await cache.get<User>('user:123');
  if (!user) {
    // Cache miss - fetch from database
    const db = await katax.database({ name: 'main', ... });
    return await db.query('SELECT * FROM users WHERE id = $1', [123]);
  }
  return user;
} catch (error) {
  katax.logger.error({ message: 'Cache error, falling back to DB', error });
  // Fallback to database
  const db = await katax.database({ name: 'main', ... });
  return await db.query('SELECT * FROM users WHERE id = $1', [123]);
}
```

### 6. Graceful Shutdown

```typescript
// Always close connections properly
process.on('SIGTERM', async () => {
  katax.logger.info({ message: 'Shutting down gracefully...' });
  await katax.shutdown(); // Closes all databases, websockets, stops cron jobs
  process.exit(0);
});

process.on('SIGINT', async () => {
  await katax.shutdown();
  process.exit(0);
});
```

### 7. Multiple Redis Instances

Separate concerns using different Redis databases:

```typescript
// Cache - db 0
await katax.database({ name: 'cache', type: 'redis', connection: { db: 0 } });

// Sessions - db 1
await katax.database({ name: 'sessions', type: 'redis', connection: { db: 1 } });

// Rate limiting - db 2
await katax.database({ name: 'rate-limit', type: 'redis', connection: { db: 2 } });
```

---

## API Reference

### Katax Class

#### `getInstance(): Katax`
Get the singleton instance.

#### `database(config: DatabaseConfig): Promise<IDatabaseService>`
Create or retrieve a database connection.

- **Parameters**:
  - `config.name`: Optional connection name (default: 'default')
  - `config.type`: `'postgresql' | 'mysql' | 'mongodb' | 'redis'`
  - `config.connection`: Connection options or string
  - `config.pool`: Optional pool configuration

- **Returns**: Database service instance

#### `socket(config: WebSocketConfig): Promise<IWebSocketService>`
Create or retrieve a WebSocket server.

- **Parameters**:
  - `config.name`: Optional server name (default: 'default')
  - `config.port`: Port number
  - `config.path`: Optional path (default: '/socket.io')

- **Returns**: WebSocket service instance

#### `cache(redisName: string = 'cache'): CacheService`
Create a cache service from a Redis connection.

- **Parameters**:
  - `redisName`: Name of the Redis database connection

- **Returns**: CacheService instance

- **Throws**: Error if connection doesn't exist or isn't Redis

#### `cron(job: CronJobConfig): void`
Add a cron job.

- **Parameters**:
  - `job.name`: Unique job name
  - `job.schedule`: Cron expression
  - `job.task`: Async function to execute
  - `job.enabled`: Optional condition function
  - `job.runOnInit`: Optional, run on startup

#### `shutdown(): Promise<void>`
Close all connections and stop all jobs.

### CacheService API

| Method | Parameters | Returns | Description |
|--------|------------|---------|-------------|
| `get<T>` | `key: string` | `Promise<T \| null>` | Get value with automatic JSON deserialization |
| `set` | `key: string, value: unknown, ttl?: number` | `Promise<void>` | Set value with optional TTL (seconds) |
| `del` | `key: string` | `Promise<void>` | Delete single key |
| `delMany` | `keys: string[]` | `Promise<number>` | Delete multiple keys, returns count |
| `exists` | `key: string` | `Promise<boolean>` | Check if key exists |
| `ttl` | `key: string` | `Promise<number>` | Get TTL in seconds |
| `expire` | `key: string, seconds: number` | `Promise<void>` | Set expiration on existing key |
| `incr` | `key: string` | `Promise<number>` | Increment by 1, returns new value |
| `incrBy` | `key: string, n: number` | `Promise<number>` | Increment by N, returns new value |
| `decr` | `key: string` | `Promise<number>` | Decrement by 1, returns new value |
| `mget<T>` | `keys: string[]` | `Promise<(T \| null)[]>` | Get multiple keys |
| `mset` | `entries: Record<string, unknown>` | `Promise<void>` | Set multiple keys |
| `clear` | `pattern: string` | `Promise<void>` | Delete keys matching pattern |
| `stats` | - | `Promise<Record<string, string>>` | Get Redis INFO statistics |

### ConfigService

- `get<T>(key: string, defaultValue?: T): T | undefined`
- `has(key: string): boolean`
- `getAll(): Record<string, unknown>`

### LoggerService

- `info(data: { message: string; [key: string]: unknown }): void`
- `error(data: { message: string; [key: string]: unknown }): void`
- `warn(data: { message: string; [key: string]: unknown }): void`
- `debug(data: { message: string; [key: string]: unknown }): void`
- `fatal(data: { message: string; [key: string]: unknown }): void`

### IDatabaseService

- `query<T>(sql: string, params?: unknown[]): Promise<T>`
- `getClient(): Promise<unknown>`
- `redis(...args): Promise<unknown>` (Redis only)
- `close(): Promise<void>`

### IWebSocketService

- `emit(event: string, data: unknown): void`
- `emitToRoom(room: string, event: string, data: unknown): void`
- `on(event: string, handler: (data: unknown) => void): void`
- `close(): Promise<void>`

---

## TypeScript Types

```typescript
import type { 
  DatabaseConfig,
  PostgreSQLConnectionOptions,
  MySQLConnectionOptions,
  MongoDBConnectionOptions,
  RedisConnectionOptions,
  WebSocketConfig,
  CronJobConfig,
  IDatabaseService,
  IWebSocketService,
  CacheService
} from 'katax-service-manager';
```

---

## License

MIT © Vinicio Esparza
