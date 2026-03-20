# Changelog

All notable changes to this project will be documented in this file.

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
