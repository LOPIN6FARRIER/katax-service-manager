# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

`katax-service-manager` (currently v0.5.9) — a singleton runtime service container for Node.js apps. Manages config, Pino-based logging, database pools (PostgreSQL/MySQL/MongoDB/Redis), WebSocket (Socket.IO), cron, cache, and a registry/heartbeat system, with graceful shutdown wired to SIGTERM/SIGINT. Part of the Katax ecosystem alongside `katax-core` (validation) and `katax-cli` (scaffolding), sibling repos under `Katax-ecosytem/`.

ESM-only package (`"type": "module"`), Node >= 18, all runtime DB/WS/cron/pino-pretty/dotenv deps are **optional peer dependencies** — the code dynamically imports them so the package works with none installed until a feature needing them is used.

## Commands

```bash
npm run build          # tsc --build (prebuild runs `clean` = rimraf dist)
npm run dev             # tsx watch src/index.ts
npm test                 # vitest (watch mode)
npm run test:coverage    # vitest --coverage
npm run typecheck        # tsc --noEmit
npm run lint              # eslint src --ext .ts
npm run format             # prettier --write "src/**/*.ts"
npm run format:check
```

Run a single test file or test name with vitest directly, e.g.:
```bash
npx vitest run src/services/database.service.test.ts
npx vitest run -t "asRedis"
```

Test files sit next to the source they cover (`*.test.ts` colocated in `src/`, not a separate `tests/` dir).

## Architecture

### The Katax singleton (`src/katax.ts`)

`Katax` is the central class; `katax` (exported from `src/index.ts`) is `Katax.getInstance()`. It can also be instantiated directly (`new Katax()`) for isolated/multi-tenant use, but the singleton is the primary API.

Initialization flow, `katax.init(config?)`:
1. Guards against concurrent calls — a second `init()` while one is in flight returns the same in-flight `_initPromise` rather than re-running bootstrap (race fixed after a past audit, see `katax-audit-regressions.test.ts`).
2. Optionally loads `.env` via dynamic `import('dotenv')` if `loadEnv: true` — **must be awaited or a manual `dotenv.config()` must run before `katax` is imported**, since env vars are read at usage time, not import time, but a pattern of "import katax, then call dotenv later" is still wrong (see `KataxConfigError` in bootstrap).
3. Delegates core service creation (config, logger, cron) to `BootstrapService.initialize()` (`src/services/bootstrap.service.ts`) — this keeps `Katax` itself from doing construction logic directly.
4. Registers SIGTERM/SIGINT process handlers exactly once (`registerProcessHandlers`/`removeProcessHandlers` pair — important for tests that call `Katax.reset()` repeatedly, since leaked listeners cause `MaxListenersExceededWarning`).
5. Optionally registers with an external registry (HTTP POST or custom handler) — failure here is non-fatal, logged as a warning.

Everything else (`database()`, `socket()`, `cron()`, `cache()`, `bridge()`, `heartbeat()`) is lazy and keyed by name: calling with an existing name returns the cached instance; calling while creation is in-flight returns the same pending promise (`_pendingDatabases`/`_pendingSockets` maps) rather than racing a second connection.

### Service layer (`src/services/`)

Each concern is its own service class, composed by `Katax` rather than inherited:
- `bootstrap.service.ts` — one-shot construction of config/logger/cron during `init()`.
- `lifecycle.service.ts` — shutdown orchestration: runs user shutdown hooks first, then closes databases/sockets (via `Promise.allSettled`, so one failure doesn't block others), stops cron, unregisters from the registry, closes logger transports. Errors are collected, not thrown — shutdown always completes.
- `config.service.ts` — thin env-backed config store (`get`/`set`/`has`, plus `getAll()` which exists on the class but is **not** part of the public `IConfigService` type in `types.ts`).
- `logger.service.ts` — Pino wrapper. Supports a custom `'success'` log level, WebSocket broadcast, a transport system (`addTransport`/`removeTransport`/`closeTransports`), and `getPinoLogger()` to reach the raw Pino instance (also not on `ILoggerService` — internal escape hatch).
- `database.service.ts` — one class handles all 4 DB types; `asSql()`/`asMongo()`/`asRedis()` narrow to the typed interface and throw if the underlying connection is the wrong type.
- `websocket.service.ts` — Socket.IO wrapper; `getServer()` exposes the raw `SocketIOServer` (used internally by `health.service.ts` via a duck-typed cast, not the public interface).
- `cron.service.ts`, `cache.service.ts`, `registry.service.ts`, `health.service.ts`, `redis-stream-bridge.service.ts` — one responsibility each, consumed only through `Katax`.
- `transports/` — pluggable `LogTransport` implementations (`redis.transport.ts`, `telegram.transport.ts`, `callback.transport.ts`).

### Public API surface (`src/index.ts` / `src/types.ts`)

`src/index.ts` is the sole export barrel — if you add a new public symbol, it must be re-exported there or consumers won't see it. `src/types.ts` holds every public interface/config shape; `IDatabaseService`/`ISqlDatabase`/`IMongoDatabase`/`IRedisDatabase` are separate narrowed interfaces so callers get compile-time guarantees about which methods exist for a given DB type. `LogConfig` (routing: `broadcast`/`room`/`persist`/`skip*`) is intentionally separate from `LogMessageObject` (payload data) — routing flags are stripped before reaching any transport; the old flat style (routing flags mixed into the message object) still works but is `@deprecated`.

### Error handling

All domain errors extend `KataxServiceError` (`src/errors.ts`) with a `code` and `details`: `KataxConfigError`, `KataxNotInitializedError`, `KataxDatabaseError`, `KataxRedisError`, `KataxWebSocketError`, `KataxRegistryError`. Prefer throwing/catching these over generic `Error` when working in this codebase.

### Testing conventions

- Use `Katax.reset()` in `beforeEach`/`afterEach` — it awaits `shutdown()`, clears all internal maps, and removes process listeners, so state doesn't leak across test files.
- `overrideService(key, mock)` / `clearOverride(key?)` swap in mocks by key (`'config'`, `'logger'`, `'cron'`, `'db:<name>'`, `'ws:<name>'`, `'cache:<name>'`) without touching real connections.
- `katax-audit-regressions.test.ts` specifically covers previously-fixed bugs (reset leaks, concurrent-init races, silent catches) — check it before "fixing" something that looks like one of those patterns again.
