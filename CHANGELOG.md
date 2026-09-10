# Changelog

All notable changes to this project will be documented in this file.

## [0.6.0] - 2026-09-10

### 🐛 Fixed — node-cron and socket.io were never actually optional

`node-cron` and `socket.io` are declared as optional peer dependencies, but
were statically imported at module scope (`index.ts` re-exported
`CronService`/`WebSocketService` eagerly, and `bootstrap.service.ts`
constructed a `CronService` on every `katax.init()` regardless of use).
ESM static imports resolve at module-graph-link time, so simply doing
`import { katax } from 'katax-service-manager'` required both packages to
be installed — even for apps that never call `katax.cron()` or
`katax.socket()`. Under npm's looser resolution this sometimes went
unnoticed; under pnpm's strict `node_modules` it crashed at boot with
`ERR_MODULE_NOT_FOUND`.

Both are now loaded lazily via dynamic `import()`, on first actual use:
- `katax.socket()` loads `WebSocketService` (and therefore `socket.io`)
  inside `createSocket()`, which was already async and always awaited by
  callers — no observable behavior change.
- `katax.cron()` loads `CronService` (and therefore `node-cron`) on first
  call via a new lazy singleton (`ensureCronService()`). `CronService` is
  no longer constructed during `bootstrap.service.ts`'s `initialize()`.

### ⚠️ Breaking (semver-minor, pre-1.0)

- `Katax.cron()`, `ICronService.addJob()`, and `ICronService.startJob()`
  now return `Promise<void>` instead of `void`. Existing fire-and-forget
  call sites (`katax.cron({...})` without `await`) keep working — the job
  still gets registered, just after the dynamic import resolves (a single
  microtask on a cold start; instant afterwards, since the module is
  cached). Await the call if you want registration errors (invalid
  schedule, missing `node-cron`) to surface at the call site instead of as
  an unhandled rejection.
- `index.ts` no longer re-exports the `WebSocketService`/`CronService`
  classes directly — both statically import their respective optional
  peer dependency, so re-exporting them from the entrypoint would force
  every consumer to install both again, defeating the whole fix. Use
  `katax.socket()` / `katax.cron()` on the singleton instead (this was
  already the only supported pattern in practice).
- `katax.cronService` (advanced-ops getter: `stopAll`, `getJobs`,
  `startJob`, `stopJob`, `removeJob`) now throws `KataxConfigError` if
  accessed before the first `await katax.cron(...)` call, since the
  service is no longer created eagerly during `init()`.
- `katax.healthCheck()` and `katax.shutdown()` no longer touch cron at all
  if it was never used — previously `shutdown()` always called
  `cronService.stopAll()` (harmless no-op) and `healthCheck()` always
  called `cronService.getJobs()`; both still report `cron: true` /
  `'healthy'` when cron was never engaged, instead of needlessly
  instantiating it just to probe it.

## [0.5.9] - 2026-08-06

Current published version. No functional changes tracked in this file since 0.5.8 beyond the version bump — see README.md for the current API surface (`DatabaseConfig.type` includes `'mongodb'`, `db.asMongo()`).

## [0.5.8] - 2026-06-20

### ✨ Added

#### LogConfig — Separate routing config from data
- New `LogConfig` type (`persist`, `broadcast`, `room`, `skipTransport`, `skipTelegram`, `skipRedis`)
- All logger methods now accept an optional second parameter: `logger.info('msg', { persist: true })`
- Control properties are **never** passed to transports — they are used only for routing
- `persist`, `broadcast`, `room`, `skip*` no longer appear in Redis Stream `meta` field
- Legacy flat-object style (`{ message: 'x', persist: true }`) still works (props extracted automatically)

```typescript
// New recommended style
logger.info('Payment processed', { persist: true })
logger.info({ message: 'Payment', amount: 100 }, { broadcast: true, room: 'ops' })

// Legacy still works
logger.info({ message: 'Payment', amount: 100, persist: true })
```

### 🧹 Updated
- `RedisTransport.defaultFormat` strips control keys as safety net
- `LogMessageObject` control properties marked `@deprecated` (use `LogConfig` instead)
- `LogConfig` type exported from package

## [0.5.0] - 2026-04-01

### ✨ Added

#### Auto .env Loading
- `loadEnv: true` option in `katax.init()` automatically loads environment variables using dotenv
- Requires `dotenv` as optional peer dependency
- No need to manually call `dotenv.config()`

#### String Logger Syntax (Retrocompatible)
- All logger methods now accept both `string` and `object` parameters
- Cleaner API while maintaining backwards compatibility
```typescript
katax.logger.info('User created'); // New simple syntax
katax.logger.info({ message: 'User created', userId: 123 }); // Still works
```

#### Automatic Shutdown Handling
- `katax.onShutdown(fn)` - Register custom cleanup hooks
- SIGTERM/SIGINT handlers registered automatically during `init()`
- Heartbeats and resources cleaned up automatically on shutdown
- User hooks execute before Katax teardown
```typescript
katax.onShutdown(async () => {
  await closeCustomConnection();
});
// SIGTERM/SIGINT handlers are automatic!
```

#### Automatic Heartbeat Cleanup
- `katax.heartbeat()` returns `{ stop: () => void }`
- Heartbeats automatically stopped during `katax.shutdown()`
- No manual tracking needed

#### Type Improvements
- `LogLevel` type exported from main package
- `LogEntry` interface for transport type safety
- `LogMessage` changed to `string | LogMessageObject` union type
- `katax.env()` with proper type inference based on default value
```typescript
const port = katax.env('PORT', 3000);      // number
const debug = katax.env('DEBUG', false);   // boolean
const name = katax.env('NAME', 'api');     // string
```

#### RedisTransport Customization
- `RedisTransportOptions` interface for advanced configuration
- Dynamic stream keys with function support
- Custom format function to control log structure
- `maxLen` option for automatic stream trimming
```typescript
new RedisTransport(redis, {
  streamKey: (log) => `logs:${log.appName}:${log.level}`,
  format: (log) => ({ severity: log.level, msg: log.message }),
  maxLen: 5000
});
```

### 🔧 Changed

#### Redis Auto-Reconnect
- Redis connections now include default reconnect strategy
- Automatic exponential backoff (max 3 seconds)
- No configuration needed

#### Optional Peer Dependencies
- `socket.io` moved to optional peer dependencies
- `node-cron` moved to optional peer dependencies
- `dotenv` added as optional peer dependency
- Smaller bundle size when features not used

#### MongoDB Query Method
- `query()` method is now optional in `IDatabaseService`
- MongoDB and Redis adapters don't expose `query()`
- Health checks updated to handle optional `query()`

### 🐛 Fixed
- Fixed health check calling non-existent `query()` on MongoDB/Redis
- Fixed duplicate `peerDependenciesMeta` entry in package.json
- Fixed type safety in log transports (removed `any` casts)
- Fixed template literal escaping in telegram transport

### 💥 Breaking Changes

1. **LogMessage Type** - Changed from `interface` to `string | LogMessageObject` union
   - Migration: No changes needed - fully backwards compatible

2. **Optional Peer Dependencies** - `socket.io` and `node-cron` must be installed explicitly
   - Migration: `npm install socket.io node-cron` if using these features

3. **MongoDB/Redis query()** - These adapters no longer expose `query()` method
   - Migration: Use native client methods instead

### 📦 Migration Guide: 0.4.x → 0.5.0

```bash
# Install optional dependencies if needed
npm install socket.io node-cron dotenv
```

```typescript
// Simplify initialization
await katax.init({ loadEnv: true }); // Replaces dotenv.config()

// Simplify shutdown
katax.onShutdown(async () => {
  // Custom cleanup only
});
// No need for manual process.on() handlers

// Use simpler logger syntax
katax.logger.info('Message'); // Instead of { message: 'Message' }
```

---

## [0.4.1] - 2026-03-20
### Fixed
- **RedisTransport**: Convert numeric values to strings for Redis v5+ compatibility
  - Fixed `Date.now()` timestamp conversion (was passing number, now string)
  - Ensures compatibility with stricter Redis client v5.x argument validation
- **RedisStreamBridgeService**: Convert `blockTimeout` and `batchSize` to strings for XREADGROUP
  - Redis v5+ requires all command arguments to be strings or Buffers
  - Previous versions (v4.x) were more tolerant and auto-converted numbers

## [0.4.0] - 2026-03-20
### Added
- `RedisStreamBridgeService`: New service for Redis Stream to WebSocket bridging.
  - Reads logs from Redis Streams (XREADGROUP) and broadcasts via WebSocket
  - Consumer group per app (e.g., `katax-bridge-trade-alerts`) to avoid message loss
  - Filters logs by `appName` to support multiple apps on same Redis
  - Historical log retrieval with `subscribe-project` event
  - Auto-joins WebSocket rooms for app-specific broadcasting
- `katax.bridge()` method to create and manage bridge instances.
- Extended `LogMessage` interface with documented optional properties:
  - `persist`, `skipTransport`, `skipTelegram`, `skipRedis`, `userId`, `requestId`, `duration`, `statusCode`, `method`, `path`, `ip`
  - Better TypeScript autocomplete for structured logging

### Changed
- `TelegramTransport.filter` is now public and optional (was private).
- `LoggerService` now works before `init()` with lazy initialization:
  - Creates default logger instance on first use
  - Gets reconfigured during `init()` if logger config provided
  - Shows warning if logger config passed to `init()` but logger already used
- `BootstrapService.initialize()` now reuses existing logger instead of replacing it.

### Fixed
- Telegram messages no longer show ugly JSON with only `timestamp` - now filters internal flags and shows readable date/time.
- TypeScript strict mode compatibility for `LogMessage` with `exactOptionalPropertyTypes`.

## [0.3.5] - 2026-03-02
### Added
- `TelegramTransport`: New log transport for sending logs to Telegram chats/groups.
  - Supports filtering by log levels (`error`, `fatal`, etc.)
  - Includes `persist` flag support for important logs
  - Auto-formatting with emojis, metadata, and timestamps
  - Configurable message length and parse mode (Markdown/HTML)

## [0.3.4] - 2026-02-21
### Fixed
- `CronService`: `runOnInit` now also executes for jobs added dynamically after `init()` via `addJob()` / `katax.cron(...)`.

## [0.2.0] - 2026-02-15
### Added
- `LogTransport` interface for pluggable log transports.
- `RedisTransport` and `CallbackTransport` implementations.
- `LoggerService` extended with `addTransport`, `removeTransport`, and `setAppName`.
- `registerVersionToRedis` helper to record app version into Redis Streams.
- `startHeartbeat` helper to publish presence keys with TTL for liveness detection.
- Public exports for transports and helpers.

### Notes
- No breaking changes expected; new APIs are additive. Update your consumer apps to set `appName` or rely on automatic detection from `package.json` or `KATAX_APP_NAME` environment variable.
