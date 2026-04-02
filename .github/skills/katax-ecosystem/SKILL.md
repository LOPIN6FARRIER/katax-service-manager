---
name: katax-ecosystem
description: 'Expert guidance for building Node.js APIs with the Katax ecosystem (katax-core validation, katax-service-manager singleton, katax-cli scaffolding). Use when: working with katax packages, setting up bootstrap, adding endpoints, validating requests, configuring databases/WebSocket/cron, troubleshooting initialization order, implementing graceful shutdown.'
argument-hint: 'What aspect of Katax are you working with? (validation/bootstrap/cli/troubleshooting)'
---

# Katax Ecosystem

Expert guidance for the **Katax ecosystem**: three internal TypeScript packages for building and maintaining Node.js APIs on self-hosted VPS infrastructure (PM2 + Ubuntu).

## When to Use

- Setting up a new Katax-based API project
- Adding request validation with katax-core schemas
- Configuring services with katax-service-manager
- Troubleshooting initialization order or service connection issues
- Implementing WebSocket, cron jobs, or Redis integration
- Setting up proper logging, transports, and monitoring
- Generating endpoints with katax-cli

## The Three Packages

### 1. katax-core — Validation Library

Zod-inspired schema validation for request bodies, env vars, and runtime type-checking.

#### Quick Start

```ts
import { k, type kataxInfer } from 'katax-core';

const UserSchema = k.object({
  email: k.email(),
  name: k.string().min(2).max(100),
  age: k.number().min(18).optional(),
});

type User = kataxInfer<typeof UserSchema>;

const result = UserSchema.safeParse(req.body);
if (!result.success) {
  return res.status(400).json({ errors: result.issues });
}
```

#### Schema Primitives

- `k.string()`, `k.number()`, `k.boolean()`, `k.date()`
- `k.email()`, `k.any()`, `k.unknown()`, `k.never()`
- `k.literal('value')`, `k.enum(['a', 'b'] as const)`

#### Modifiers (chainable)

- `.min(n)`, `.max(n)`, `.int()`
- `.optional()` → `T | undefined`
- `.nullable()` → `T | null`
- `.default(value)`, `.catch(fallback)`
- `.transform(fn)`, `.asyncRefine(fn)`

#### Composites

- `k.array(schema)`
- `k.record(schema)` → `Record<string, T>`
- `k.tuple([schema1, schema2])`
- `k.union([schema1, schema2])`
- `k.intersection([schema1, schema2])`
- `k.lazy(() => schema)` — for recursive types

#### Coercion (query params / form data)

```ts
import { coerce } from 'katax-core';

coerce.number(); // "42" → 42
coerce.boolean(); // "true" / "1" → true
coerce.date(); // ISO string → Date
```

#### Express Validation Middleware

```ts
function validate<T>(schema: { safeParse(v: unknown): any }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({ errors: result.issues });
    }
    req.body = result.data;
    next();
  };
}

router.post('/posts', validate(CreatePostSchema), handler);
```

---

### 2. katax-service-manager — Application Bootstrap

Singleton service container managing the full lifecycle: config, logger, databases, WebSocket, cron, cache, graceful shutdown.

#### ⚠️ Critical Initialization Order

```ts
// ✅ CORRECT ORDER - Option 1: Manual dotenv
import dotenv from 'dotenv';
dotenv.config(); // 1. Load env vars FIRST
import { katax } from 'katax-service-manager'; // 2. Import katax AFTER dotenv

// ✅ CORRECT ORDER - Option 2: Built-in loadEnv (v0.5+)
import { katax } from 'katax-service-manager';
await katax.init({ loadEnv: true }); // Loads .env automatically

// ❌ WRONG — katax reads env at import time, before dotenv loads
import { katax } from 'katax-service-manager';
import dotenv from 'dotenv';
dotenv.config();
```

**Why**: The katax singleton is instantiated at import time. If dotenv runs after, environment variables will be undefined when katax reads them. From v0.5+, you can use `loadEnv: true` option instead.

#### Bootstrap Template

```ts
import dotenv from 'dotenv';
dotenv.config();

import { katax } from 'katax-service-manager';
import { createServer } from 'http';
import app from './app.js';

async function bootstrap(): Promise<void> {
  try {
    // Step 1: Initialize katax (config, logger, cron)
    await katax.init({
      loadEnv: true, // Load .env automatically (v0.5+)
      logger: {
        level: katax.env('LOG_LEVEL', 'info') as any,
        prettyPrint: katax.isDev,
        enableBroadcast: true,
      },
    });

    // Step 2: Setup databases
    await katax.database({
      name: 'main',
      type: 'postgresql',
      connection: {
        host: katax.envRequired('DB_HOST'),
        port: katax.env('DB_PORT', 5432),
        database: katax.envRequired('DB_NAME'),
        user: katax.envRequired('DB_USER'),
        password: katax.envRequired('DB_PASSWORD'),
      },
      pool: { max: 10, min: 2 },
    });

    // Step 3: Setup WebSocket
    const PORT = katax.env('PORT', '3000');
    const httpServer = createServer(app);

    await katax.socket({
      name: 'main',
      httpServer,
      cors: { origin: '*' },
    });

    // Step 4: Start server
    httpServer.listen(PORT, () => {
      katax.logger.info({ message: `Server running on http://localhost:${PORT}` });
    });

    // Step 5: Graceful shutdown handlers
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
    process.on('SIGINT', () => void shutdown('SIGINT'));
  } catch (err) {
    console.error('Bootstrap failed:', err);
    process.exit(1);
  }
}

const shutdown = async (signal: string) => {
  katax.logger.info({ message: `${signal} received, shutting down...` });
  await katax.shutdown();
  process.exit(0);
};

void bootstrap();
```

#### Environment Helpers

```ts
katax.env('PORT', '3000'); // string with default
katax.env('PORT', 3000); // number (auto-cast)
katax.env('DEBUG', false); // boolean (auto-cast)
katax.envRequired('JWT_SECRET'); // throws if missing

katax.isDev; // NODE_ENV === 'development' or not set
katax.isProd; // NODE_ENV === 'production'
katax.isTest; // NODE_ENV === 'test'
katax.nodeEnv; // raw NODE_ENV string
katax.appName; // from package.json (name)
katax.version; // from package.json (version)
```

#### Database Configuration

```ts
// PostgreSQL
await katax.database({
  name: 'main',
  type: 'postgresql',
  connection: {
    host:     katax.envRequired('DB_HOST'),
    port:     katax.env('DB_PORT', 5432),
    database: katax.envRequired('DB_NAME'),
    user:     katax.envRequired('DB_USER'),
    password: katax.envRequired('DB_PASSWORD'),
  },
  pool: { max: 10, min: 2 },
});

// Redis
await katax.database({
  name: 'cache',
  type: 'redis',
  connection: {
    host:     katax.env('REDIS_HOST', '127.0.0.1'),
    port:     katax.env('REDIS_PORT', 6379),
    password: katax.env('REDIS_PASSWORD', ''),
    db:       0,
  },
});

// Optional database (app continues if connection fails)
await katax.database({
  name: 'analytics',
  type: 'postgresql',
  required: false,  // ←  won't crash on failure
  connection: { ... },
});
```

#### ⚠️ Redis Reconnect Strategy

From v0.5+, reconnect strategy is **built-in by default**. No manual configuration needed.

```ts
// Automatic reconnect (v0.5+)
await katax.database({
  name: 'cache',
  type: 'redis',
  connection: { host: '127.0.0.1', port: 6379 },
});
// Reconnect strategy already included!
```

For custom Redis clients outside katax:

```ts
import { createClient } from 'redis';

const client = createClient({
  url: 'redis://localhost:6379',
  socket: {
    reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
  },
});
```

#### Database Access

```ts
// SQL databases (PostgreSQL, MySQL)
const db = katax.db('main');
const rows = await db.query('SELECT * FROM users WHERE id = $1', [userId]);

// MongoDB must use getClient()
const db = katax.db('mongo');
const client = db.getClient();
const users = await client.db('mydb').collection('users').find({});

// Redis operations
const redis = katax.db('cache');
const client = redis.getClient();
await client.set('key', 'value', { EX: 3600 });
```

#### Logger (Structured)

All log methods accept **string or object**:

```ts
// Simple strings (v0.5+)
katax.logger.info('Server started');
katax.logger.error('Connection failed');

// Full objects
katax.logger.info({ message: 'Server started', port: 3000 });
katax.logger.warn({ message: 'Redis unavailable', err });
katax.logger.error({ message: 'Query failed', err, query: sql });
katax.logger.debug({ message: 'Cache hit', key });

// Broadcast to WebSocket clients
katax.logger.info({
  message: 'Trade executed',
  broadcast: true,
  trade: { symbol: 'BTC', amount: 1.5 },
});

// Broadcast to specific room
katax.logger.warn({
  message: 'Alert triggered',
  broadcast: true,
  room: 'admins',
  alert: { type: 'high-load' },
});

// Force persist to Redis transport
katax.logger.info({ message: 'Critical event', persist: true });

// Skip transports (avoid feedback loops)
katax.logger.warn({ message: 'Transport failed', skipTransport: true });

// Child logger with bound context
const log = katax.logger.child({ service: 'spotify', userId: 123 });
log.info({ message: 'Token refreshed' });
```

#### Transports

```ts
import { RedisTransport, TelegramTransport } from 'katax-service-manager';

// Redis transport — persist logs to Redis Stream
const redisTransport = new RedisTransport(katax.db('cache'), 'katax:logs');
redisTransport.filter = (log) => log.level === 'error' || log.persist === true;
katax.logger.addTransport(redisTransport);

// Telegram transport — critical alerts
const telegramTransport = new TelegramTransport({
  botToken: katax.envRequired('TELEGRAM_BOT_TOKEN'),
  chatId: katax.envRequired('TELEGRAM_ALERTS_CHAT_ID'),
  levels: ['error', 'fatal'],
  includePersist: true,
  parseMode: 'Markdown',
  name: 'telegram-errors',
});
katax.logger.addTransport(telegramTransport);
```

#### WebSocket (Socket.io)

```ts
// Attached to Express (shared port — preferred)
const httpServer = createServer(app);
await katax.socket({
  name: 'main',
  httpServer,
  cors: { origin: '*' },
});

// Standalone port
await katax.socket({
  name: 'events',
  port: 3001,
  cors: { origin: 'https://myapp.com' },
  enableAuth: true,
});

// Access anywhere
const ws = katax.ws('main');
ws.emit('user:update', { userId, data });
ws.to('room-123').emit('message', payload);
```

#### Cron Jobs

```ts
katax.cron({
  name: 'process-assets',
  schedule: '*/10 6-15 * * 1-5', // every 10 min, 6am-3pm, Mon-Fri
  task: processAssets,
  runOnInit: katax.isProd, // run immediately on startup
  timezone: 'America/Mexico_City',
});

// Advanced operations
katax.cronService.stopAll();
katax.cronService.startJob('process-assets');
katax.cronService.removeJob('process-assets');
katax.cronService.getJobs();
```

#### Cache (Redis High-Level API)

```ts
// Requires a redis database named 'cache' to exist
const cache = katax.cache('cache');

await cache.set('user:123', userData, 3600); // TTL in seconds
const user = await cache.get<User>('user:123');
await cache.delete('user:123');
```

#### Redis Stream Bridge (Logs → WebSocket)

Bridges Redis Stream logs to WebSocket for real-time dashboards:

```ts
const bridge = katax.bridge('cache', 'main', {
  appName: 'my-api',
  streamKey: 'katax:logs',
  batchSize: 10,
});
await bridge.start();

// Stop on shutdown
const shutdown = async (signal: string) => {
  bridge?.stop();
  await katax.shutdown();
};
```

#### Managed Heartbeat (v0.5+)

Katax now manages heartbeats automatically — no need to save references:

```ts
// Auto-cleanup on shutdown
katax.heartbeat(
  {
    app: katax.appName,
    port: 3000,
    version: katax.version,
    intervalMs: 10000,
  },
  'cache', // Redis database name
  'main' // Optional WebSocket name for broadcasting
);

// No need to save reference or call .stop()
// katax.shutdown() handles cleanup automatically
```

#### Registry Helpers (Legacy)

For manual control, you can still use the low-level helpers:

```ts
import {
  registerProjectInRedis,
  registerVersionToRedis,
  startHeartbeat,
} from 'katax-service-manager';

const redisDb = katax.db('cache');
katax.logger.setAppName('my-api');

await registerProjectInRedis(redisDb, {
  app: katax.appName,
  version: katax.version,
  port: PORT,
  extra: { env: katax.nodeEnv, url: 'https://api.example.com' },
});

// Manual heartbeat (need to call .stop() yourself)
const hb = startHeartbeat(
  redisDb,
  {
    app: katax.appName,
    port: PORT,
    intervalMs: 10000,
    version: katax.version,
  },
  katax.ws('main')
);

// Stop on shutdown
hb?.stop();
```

#### Health Check Endpoint

```ts
app.get('/api/health', async (req, res) => {
  const health = await katax.healthCheck();
  const status = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 503 : 500;
  res.status(status).json(health);
});
```

#### Testing — Override Services

```ts
import { Katax } from 'katax-service-manager';

beforeEach(() => {
  Katax.reset();
});

katax.overrideService('db:main', mockDb);
katax.overrideService('logger', mockLogger);
katax.clearOverride('db:main');
```

---

### 3. katax-cli — Project & Endpoint Generator

CLI tool for scaffolding katax-based APIs and adding routes.

#### Commands

```bash
# Initialize new API project
katax init

# Add endpoint/resource
katax add endpoint

# Check deployment status
katax deploy status

# View logs
katax deploy logs
```

When generating, always follow katax-service-manager patterns:

- Use `katax.db('name')` for DB access
- Use katax-core schemas for validation
- Follow the bootstrap template for `index.ts`

---

## Common Gotchas & Rules

### Initialization Order

1. ✅ **ALWAYS** call `dotenv.config()` before importing `katax`
2. ✅ **ALWAYS** call `katax.init()` before using any services
3. ❌ **NEVER** use `katax.db()` or `katax.ws()` before `katax.init()` completes

### Database Operations

- `db.query()` only works for SQL (PostgreSQL/MySQL)
- MongoDB must use `db.getClient()` for typed operations
- `db.redis()` uses raw `sendCommand` — prefer `db.getClient()` for typed Redis
- Redis needs explicit reconnect strategy (not built-in yet)

### Logger

- ✅ Always pass an object: `{ message: string, ...meta }`
- ❌ Never pass plain string: `logger.info('message')` will fail
- Use `broadcast: true` to emit to WebSocket
- Use `persist: true` to force Redis transport
- Use `skipTransport: true` to avoid feedback loops

### Validation

- ✅ Always validate `req.body` with katax-core `.safeParse()`
- ❌ Never trust raw `req.body` without validation
- Use `coerce` schemas for query params (strings → numbers/booleans)

### Optional Services

- Set `required: false` on databases to make them optional
- App continues if optional services fail (analytics, cache, etc.)
- Always check if service exists before accessing

---

## Troubleshooting

### "Cannot access X before initialization"

**Cause**: Accessing service before `katax.init()` completes.

**Fix**: Ensure `await katax.init()` completes before using services.

### Redis connection drops

**Cause**: No reconnect strategy configured.

**Fix**: Add reconnect strategy to Redis client:

```ts
socket: {
  reconnectStrategy: (retries) => Math.min(retries * 100, 3000),
}
```

### Environment variables undefined

**Cause**: `dotenv.config()` called after importing `katax`.

**Fix**: Move `dotenv.config()` to the very top, before any imports.

### Logger throws "message is required"

**Cause**: Passing plain string instead of object.

**Fix**: Always use object syntax: `logger.info({ message: 'text' })`

### Database query fails with TypeScript error

**Cause**: Using `.query()` on MongoDB or wrong DB type.

**Fix**:

- SQL: Use `db.query(sql, params)`
- MongoDB: Use `db.getClient().db().collection()`
- Redis: Use `db.getClient()` for typed operations

---

## Quick Reference Checklist

When setting up a new Katax project:

- [ ] `dotenv.config()` at top of entry file
- [ ] Import `katax` after dotenv
- [ ] Call `await katax.init()` with logger config
- [ ] Setup databases with `await katax.database()`
- [ ] Add Redis reconnect strategy if using Redis
- [ ] Setup WebSocket with `await katax.socket()` if needed
- [ ] Add cron jobs with `katax.cron()` if needed
- [ ] Add transports (Redis, Telegram) if needed
- [ ] Create graceful shutdown handlers (SIGTERM, SIGINT)
- [ ] Add health check endpoint
- [ ] Validate all request bodies with katax-core schemas

---

## Next Steps

After creating this skill, consider:

1. Creating workspace instructions (`.github/copilot-instructions.md`) to always apply Katax patterns
2. Adding error handling prompts for common Katax errors
3. Creating endpoint templates in CLI package
4. Setting up pre-commit hooks to validate schema usage
