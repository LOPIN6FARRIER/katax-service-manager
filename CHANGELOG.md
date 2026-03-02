# Changelog

All notable changes to this project will be documented in this file.

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
