# Changelog

All notable changes to this project will be documented in this file.

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
