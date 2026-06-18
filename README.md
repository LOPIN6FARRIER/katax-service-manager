# Katax Service Manager

[![npm version](https://img.shields.io/npm/v/katax-service-manager.svg)](https://www.npmjs.com/package/katax-service-manager)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Runtime service container for Node.js applications** - Manages shared services like config, logging, database pools, caching, and WebSocket connections with a singleton pattern.

**Version**: 0.5.4 | **Node**: >= 18

## Features

- Singleton or isolated instances (`Katax.getInstance()` or `new Katax()`)
- Pino-based structured logging with broadcast, transports, and child loggers
- Database connection pools for PostgreSQL, MySQL, MongoDB, and Redis
- High-level Redis cache with JSON serialization and pattern-based clear
- Cron job management with dynamic add/remove/start/stop
- WebSocket real-time communication via Socket.IO
- Redis Stream Bridge for log streaming
- Heartbeat system for service presence
- Registry integration (HTTP or custom handler)
- Lifecycle hooks (`beforeInit`, `afterInit`, `beforeShutdown`, `afterShutdown`, `onError`)
- Override system for testing/mocking
- Environment variable helpers with type inference
- Health check API
- Transport system for log persistence (Redis, Telegram, custom callback)
- Full TypeScript support

## Installation

```bash
npm install katax-service-manager
```

### Optional peer dependencies

```bash
npm install pg               # PostgreSQL
npm install mysql2           # MySQL
npm install mongodb          # MongoDB
npm install redis            # Redis (cache, streams, pub/sub)
npm install socket.io        # WebSocket
npm install node-cron        # Cron jobs
npm install dotenv           # Auto-load .env
npm install pino-pretty      # Pretty-print logs in development
```

## Quick Start

```typescript
import { katax } from 'katax-service-manager';

await katax.init({ loadEnv: true });

// Create database connection
const db = await katax.database({
  name: 'main',
  type: 'postgresql',
  connection: {
    host: 'localhost',
    user: 'admin',
    password: 'secret',
    database: 'myapp',
  },
});

// Query
const users = await db.query('SELECT * FROM users WHERE active = $1', [true]);

// Logger
katax.logger.info({ message: 'App started', users: users.length });

// Graceful shutdown
process.on('SIGTERM', async () => {
  await katax.shutdown();
  process.exit(0);
});
```

## Core Concepts

### Singleton vs Isolated Instance

```typescript
import { Katax, katax } from 'katax-service-manager';

// Pre-exported singleton (recommended)
katax.init();

// Or explicit singleton
Katax.getInstance();

// Isolated instance (testing / multi-context)
const instance = new Katax();
await instance.init();

// Reset singleton (testing)
Katax.reset();
```

### Service Reuse

Requesting the same connection by name returns the existing instance:

```typescript
const db1 = await katax.database({ name: 'main', type: 'postgresql', ... });
const db2 = await katax.database({ name: 'main', type: 'postgresql', ... });
console.log(db1 === db2); // true
```

### Graceful Shutdown

```typescript
await katax.shutdown(); // Closes all databases, WebSockets, bridges, heartbeats, stops cron

// Register custom shutdown hooks
katax.onShutdown(async () => {
  await closeCustomConnection();
});
```

## Environment Helpers

```typescript
// Type inferred from default value
const port = katax.env('PORT', 3000);       // number
const debug = katax.env('DEBUG', false);     // boolean
const host = katax.env('HOST', 'localhost'); // string

// Required (throws KataxConfigError if not set)
const secret = katax.envRequired('JWT_SECRET');
```

## Configuration Service

```typescript
const port = katax.config.get('PORT', 3000);
const all = katax.config.getAll();
const exists = katax.config.has('API_KEY');
katax.config.set('custom', value);
```

## Logger Service

Pino-based structured logging with WebSocket broadcast and pluggable transports.

### Log Levels

```typescript
katax.logger.trace({ message: 'Entering function' });
katax.logger.debug({ message: 'Processing item' });
katax.logger.info({ message: 'Server started' });
katax.logger.success({ message: 'User registered' });
katax.logger.warn({ message: 'High memory usage' });
katax.logger.error({ message: 'Connection failed', error: err });
katax.logger.fatal({ message: 'Unrecoverable error' });
```

> **Note:** `success` is a custom log level (between `info` and `warn`) that displays in **blue** with pino-pretty when `prettyPrint` is enabled.

### Structured Log Objects

```typescript
katax.logger.info({
  message: 'User logged in',
  userId: 123,
  ip: '192.168.1.1',
  method: 'POST',
  path: '/login',
  duration: 45,
  statusCode: 200,
  requestId: 'req-abc-123',
  code: 'AUTH_OK',
  broadcast: true,   // emit to WebSocket
  room: 'admin',      // WebSocket room
  persist: true,      // force transport persistence
  skipTransport: true,// skip all transports
  skipTelegram: true, // skip Telegram only
  skipRedis: true,    // skip Redis only
});
```

### Child Loggers

```typescript
const childLogger = katax.logger.child({ module: 'users' });
childLogger.info({ message: 'User created' }); // includes { module: 'users' }
```

### Logger Configuration

```typescript
await katax.init({
  logger: {
    level: 'debug',
    prettyPrint: true,    // requires pino-pretty
    enableBroadcast: true, // emit logs to WebSocket
    destination: '/var/log/app.log',
  },
});
```

### Transports

```typescript
import { RedisTransport, CallbackTransport, TelegramTransport } from 'katax-service-manager';

// Redis transport (writes to stream)
const redisTransport = new RedisTransport(redisDb, {
  streamKey: 'myapp:logs',
  maxLen: 10000,
  name: 'redis',
});
katax.logger.addTransport(redisTransport);

// Callback transport
const callbackTransport = new CallbackTransport(async (log) => {
  await myApi.send(log);
}, 'api');
katax.logger.addTransport(callbackTransport);

// Telegram transport
const telegramTransport = new TelegramTransport({
  botToken: process.env.TELEGRAM_BOT_TOKEN!,
  chatId: process.env.TELEGRAM_CHAT_ID!,
  levels: ['error', 'fatal'],
  includePersist: true,
  parseMode: 'Markdown',
});
katax.logger.addTransport(telegramTransport);

// Remove or close
katax.logger.removeTransport('redis');
await katax.logger.closeTransports();

// Access underlying Pino
const pinoLogger = katax.logger.getPinoLogger();
```

### LogTransport Interface

```typescript
interface LogTransport {
  name?: string;
  filter?(log: LogEntry): boolean;  // optional filter predicate
  send(log: LogEntry): Promise<void>;
  close?(): Promise<void>;
}
```

## Database Service

### PostgreSQL

```typescript
const pg = await katax.database({
  name: 'main',
  type: 'postgresql',
  connection: { host: 'localhost', port: 5432, user: 'admin', password: 'secret', database: 'myapp' },
  pool: { max: 20, min: 5, idleTimeoutMillis: 30000 },
});

const users = await pg.query('SELECT * FROM users WHERE id = $1', [userId]);
const client = await pg.getClient();
```

### MySQL

```typescript
const mysql = await katax.database({
  name: 'legacy',
  type: 'mysql',
  connection: { host: 'localhost', user: 'root', password: 'secret', database: 'legacy_db' },
});

const products = await mysql.query('SELECT * FROM products WHERE category = ?', ['electronics']);
```

### MongoDB

```typescript
const mongo = await katax.database({
  name: 'analytics',
  type: 'mongodb',
  connection: { host: 'localhost', database: 'analytics' },
});

const client = await mongo.getClient();
const db = client.db();
await db.collection('events').insertOne({ event: 'login' });
```

### Redis

```typescript
const redis = await katax.database({
  name: 'cache',
  type: 'redis',
  connection: { host: 'localhost', port: 6379, db: 0 },  // or connection string
});

await redis.redis('SET', 'key', 'value', 'EX', '60');
const val = await redis.redis('GET', 'key');
```

### Typed Database Access

```typescript
const db = katax.db('main');
db.asSql()    // ISqlDatabase - PostgreSQL or MySQL
db.asMongo()  // IMongoDatabase
db.asRedis()  // IRedisDatabase
```

## Cache Service

High-level Redis wrapper with automatic JSON serialization:

```typescript
const cache = katax.cache('cache'); // default: 'cache'

// Basic operations
await cache.set('user:123', { name: 'John' }, 3600);
const user = await cache.get<{ name: string }>('user:123'); // null if missing
await cache.del('user:123');
await cache.delMany(['key1', 'key2']);
const exists = await cache.exists('user:123');
const ttl = await cache.ttl('user:123');
await cache.expire('user:123', 300);

// Counters
await cache.incr('views');
await cache.incrBy('views', 10);
await cache.decr('views');

// Batch operations
await cache.mset([['key1', val1], ['key2', val2]]);
const values = await cache.mget(['key1', 'key2']);

// Pattern clear (disabled for '*' in production)
const deleted = await cache.clear('temp:*');

// Redis INFO stats
const stats = await cache.stats();
```

## Cron Service

```typescript
// Shortcut via katax.cron()
katax.cron({
  name: 'cleanup',
  schedule: '0 0 * * *',
  task: async () => { await cleanupOldData(); },
  enabled: () => process.env.NODE_ENV === 'production',
  runOnInit: false,
  timezone: 'America/New_York',
});

// Advanced management via katax.cronService
const jobs = katax.cronService.getJobs();
// [{ name: 'cleanup', schedule: '0 0 * * *', enabled: true, running: true }]

katax.cronService.startJob('cleanup');
katax.cronService.stopJob('cleanup');
katax.cronService.removeJob('cleanup');
katax.cronService.stopAll();
```

## WebSocket Service

```typescript
const ws = await katax.socket({
  name: 'main',
  port: 3001,
  cors: { origin: '*' },
  enableAuth: true,
  authToken: 'secret',
  // or authValidator: (token) => token === 'custom',
});

// Emit events
ws.emit('notification', { message: 'New update' });
ws.emitToRoom('room1', 'event', data);

// Listen
ws.on('client-message', (data) => {});
ws.onConnection((socket) => {
  socket.emit('welcome', 'Hello');
  socket.on('ping', () => {});
  socket.join('room-name');
  socket.leave('room-name');
});

// Query state
ws.hasRoomListeners('room1');
ws.getRoomClientsCount('room1');
ws.hasConnectedClients();
ws.getConnectedClientsCount();

// Access underlying Socket.IO server
const io = ws.getServer(); // SocketIOServer | null

// Quick access by name
const mainWs = katax.ws('main');

await ws.close();
```

## Redis Stream Bridge

Streams logs from Redis to WebSocket in real-time:

```typescript
const bridge = katax.bridge('redis', 'main', {
  appName: katax.appName,
  streamKey: 'katax:logs',       // default
  group: 'katax-bridge-myapp',   // default: katax-bridge-${appName}
  batchSize: 10,                  // default
  blockTimeout: 2000,            // default
});

await bridge.start();
// bridge.stop(); bridge.isRunning();
```

## Heartbeat

```typescript
const hb = katax.heartbeat(
  { app: katax.appName, port: 3000, intervalMs: 30000, ttlSeconds: 60, version: katax.version },
  'redis',   // default
  'main'     // optional WebSocket for broadcasting
);

// hb.stop();
```

## Cache override

Prefer `katax.cache()` which auto-creates from any named Redis connection.

## Registry Strategies

### HTTP Registry

```typescript
await katax.init({
  registry: {
    url: 'https://my-dashboard.example.com/api/services',
    apiKey: process.env.REGISTRY_API_KEY,
    heartbeatInterval: 30000,
    requestTimeoutMs: 5000,
    retryAttempts: 2,
    retryBaseDelayMs: 300,
    metadata: { region: 'us-east' },
  },
});
```

### Custom Registry Handler

```typescript
await katax.init({
  registry: {
    heartbeatInterval: 30000,
    handler: {
      register: async (info: ServiceInfo) => { /* custom logic */ },
      heartbeat: async (info: ServiceInfo) => { /* custom logic */ },
      unregister: async (payload: RegistryUnregisterPayload) => { /* custom logic */ },
    },
  },
});
```

## Override System (Testing/Mocking)

```typescript
katax.overrideService('config', mockConfig);
katax.overrideService('db:main', mockDb);
katax.overrideService('logger', mockLogger);
katax.overrideService('cron', mockCron);
katax.overrideService('ws:main', mockWs);
katax.overrideService('cache:cache', mockCache);

katax.clearOverride();           // remove all
katax.clearOverride('config');   // remove specific
```

## Health Check & Service Info

```typescript
const health = await katax.healthCheck();
// { status: 'healthy' | 'degraded' | 'unhealthy',
//   services: { databases: {...}, sockets: {...}, cron: boolean },
//   timestamp: number }

const info = katax.getServiceInfo();
// { name, version, hostname, pid, uptime, memory, ... } | null
```

## Lifecycle Hooks

```typescript
await katax.init({
  hooks: {
    beforeInit: () => console.log('before init'),
    afterInit: () => console.log('ready'),
    beforeShutdown: () => console.log('shutting down'),
    afterShutdown: () => console.log('done'),
    onError: (context, error) => console.error(`${context}:`, error),
  },
});
```

## Error Classes

```typescript
import {
  KataxServiceError,       // base class (code, message, details)
  KataxConfigError,        // KATAX_CONFIG_ERROR
  KataxNotInitializedError,// KATAX_NOT_INITIALIZED
  KataxDatabaseError,      // KATAX_DATABASE_ERROR
  KataxRedisError,         // KATAX_REDIS_ERROR
  KataxWebSocketError,     // KATAX_WEBSOCKET_ERROR
  KataxRegistryError,      // KATAX_REGISTRY_ERROR
} from 'katax-service-manager';

try { await katax.init({ loadEnv: true }); }
catch (e) {
  if (e instanceof KataxConfigError) { /* handle */ }
}
```

## Redis Registration Utilities

```typescript
import { registerVersionToRedis, startHeartbeat, registerProjectInRedis } from 'katax-service-manager';

await registerVersionToRedis(redisDb, { app: 'myapp', version: '1.0', port: 3000 });
await registerProjectInRedis(redisDb, { app: 'myapp', version: '1.0' });
```

## API Reference

### Katax Class

| Method / Property | Returns | Description |
|---|---|---|
| `new Katax()` | `Katax` | Create isolated instance |
| `Katax.getInstance()` | `Katax` | Get singleton instance |
| `Katax.reset()` | `void` | Reset singleton (testing) |
| `init(config?)` | `Promise<Katax>` | Initialize services |
| `shutdown()` | `Promise<void>` | Graceful shutdown all services |
| `onShutdown(fn)` | `void` | Register custom shutdown hook |
| `overrideService(key, service)` | `void` | Override internal service for testing |
| `clearOverride(key?)` | `void` | Remove override(s) |
| `env(key, default?)` | `string \| number \| boolean` | Environment variable with type inference |
| `envRequired(key)` | `string` | Required env var (throws if missing) |
| `healthCheck()` | `Promise<HealthCheckResult>` | Health status of all services |
| `getServiceInfo()` | `ServiceInfo \| null` | Package metadata + system metrics |
| `database(config)` | `Promise<IDatabaseService \| null>` | Create/retrieve database connection |
| `db(name)` | `IDatabaseService` | Quick access to database by name |
| `socket(config)` | `Promise<IWebSocketService>` | Create/retrieve WebSocket server |
| `ws(name)` | `IWebSocketService` | Quick access to WebSocket by name |
| `cron(job)` | `void` | Add a cron job |
| `cache(redisName?)` | `CacheService` | Create cache service (default: 'cache') |
| `bridge(redisName?, socketName?, config)` | `RedisStreamBridgeService` | Create Redis stream bridge |
| `heartbeat(opts, redisName?, socketName?)` | `{ stop: () => void }` | Start managed heartbeat |

### Getters

| Property | Returns | Description |
|---|---|---|
| `config` | `IConfigService` | Config service (throws if not init) |
| `logger` | `ILoggerService` | Logger (auto-created, even before init) |
| `cronService` | `ICronService` | Advanced cron management |
| `isInitialized` | `boolean` | Whether init() was called |
| `appName` | `string` | App name from package.json |
| `version` | `string` | Version from package.json |
| `isDev` | `boolean` | NODE_ENV is 'development' or unset |
| `isProd` | `boolean` | NODE_ENV is 'production' |
| `isTest` | `boolean` | NODE_ENV is 'test' |
| `nodeEnv` | `string` | Returns NODE_ENV or 'development' |
| `isRegistered` | `boolean` | Registry registration status |

### DatabaseConfig

```typescript
interface DatabaseConfig {
  name: string;
  type: 'postgresql' | 'mysql' | 'mongodb' | 'redis';
  required?: boolean;    // default true (false returns null on failure)
  connection: string | PostgreSQLConnectionOptions | MySQLConnectionOptions | MongoDBConnectionOptions | RedisConnectionOptions;
  pool?: PoolConfig;
}
```

### WebSocketConfig

```typescript
interface WebSocketConfig {
  name: string;
  port?: number;
  httpServer?: HttpServer;
  cors?: { origin: string | string[]; credentials?: boolean };
  authToken?: string;
  enableAuth?: boolean;
  authValidator?: (token: string | undefined) => boolean | Promise<boolean>;
}
```

### CronJobConfig

```typescript
interface CronJobConfig {
  name: string;
  schedule: string;
  task: () => void | Promise<void>;
  enabled?: boolean | (() => boolean);
  runOnInit?: boolean;
  timezone?: string;
}
```

### RedisStreamBridgeConfig

```typescript
interface RedisStreamBridgeConfig {
  appName: string;
  streamKey?: string;      // default: 'katax:logs'
  group?: string;          // default: 'katax-bridge-${appName}'
  batchSize?: number;      // default: 10
  blockTimeout?: number;   // default: 2000
}
```

### KataxInitConfig

```typescript
interface KataxInitConfig {
  loadEnv?: boolean;
  appName?: string;
  logger?: LoggerConfig;
  hooks?: KataxLifecycleHooks;
  registry?: RegistryConfig;
}
```

### CacheService

| Method | Returns | Description |
|---|---|---|
| `get<T>(key)` | `Promise<T \| null>` | Get with JSON deserialization |
| `set(key, value, ttl?)` | `Promise<void>` | Set with optional TTL (seconds) |
| `del(key)` | `Promise<void>` | Delete key |
| `delMany(keys)` | `Promise<void>` | Delete multiple keys |
| `exists(key)` | `Promise<boolean>` | Check if key exists |
| `ttl(key)` | `Promise<number>` | Remaining TTL in seconds |
| `expire(key, seconds)` | `Promise<boolean>` | Set expiration |
| `incr(key)` | `Promise<number>` | Increment by 1 |
| `incrBy(key, n)` | `Promise<number>` | Increment by n |
| `decr(key)` | `Promise<number>` | Decrement by 1 |
| `mget<T>(keys)` | `Promise<(T \| null)[]>` | Get multiple values |
| `mset(entries)` | `Promise<void>` | Set multiple key-value pairs |
| `clear(pattern)` | `Promise<number>` | Delete keys matching pattern |
| `stats()` | `Promise<Record<string, string>>` | Redis INFO statistics |

## Katax Ecosystem

| Package | npm | GitHub |
|---|---|---|
| **katax-core** | [npm](https://www.npmjs.com/package/katax-core) | [GitHub](https://github.com/LOPIN6FARRIER/katax-core) |
| **katax-service-manager** | [npm](https://www.npmjs.com/package/katax-service-manager) | [GitHub](https://github.com/LOPIN6FARRIER/katax-service-manager) |
| **katax-cli** | [npm](https://www.npmjs.com/package/katax-cli) | [GitHub](https://github.com/LOPIN6FARRIER/katax-cli) |

## License

MIT © Vinicio Esparza
