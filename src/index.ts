/**
 * Katax Service Manager
 * Runtime service container for Node.js applications
 */

export { Katax, katax } from './katax.js';
export {
  KataxServiceError,
  KataxConfigError,
  KataxNotInitializedError,
  KataxDatabaseError,
  KataxRedisError,
  KataxWebSocketError,
  KataxRegistryError,
} from './errors.js';
export type {
  KataxConfig,
  KataxInitConfig,
  KataxLifecycleHooks,
  HealthCheckResult,
  RegistryConfig,
  RegistryHandler,
  RegistryUnregisterPayload,
  ServiceInfo,
  LoggerConfig,
  LogConfig,
  LogLevel,
  LogMessage,
  LogMessageObject,
  LogEntry,
  LogTransport,
  DatabaseConfig,
  WebSocketConfig,
  CronConfig,
  CronJobConfig,
  PostgreSQLConnectionOptions,
  MySQLConnectionOptions,
  MongoDBConnectionOptions,
  RedisConnectionOptions,
  PoolConfig,
  IConfigService,
  ILoggerService,
  IDatabaseService,
  ISqlDatabase,
  IMongoDatabase,
  IRedisDatabase,
  IWebSocketService,
  ICronService,
} from './types.js';
export { ConfigService } from './services/config.service.js';
export { LoggerService } from './services/logger.service.js';
export { DatabaseService } from './services/database.service.js';
// WebSocketService and CronService are intentionally NOT re-exported here:
// both statically import an optional peer dependency (socket.io, node-cron
// respectively) at module scope, so re-exporting them from this entrypoint
// would force every katax-service-manager consumer to install both, even
// apps that never call katax.socket()/katax.cron(). Use those methods on
// the katax singleton instead, which loads each service's module lazily on
// first use (see katax.ts's createSocket() / ensureCronService()).
export { CacheService } from './services/cache.service.js';
export { RegistryService } from './services/registry.service.js';
export {
  RedisStreamBridgeService,
  type RedisStreamBridgeConfig,
} from './services/redis-stream-bridge.service.js';
export { RedisTransport } from './services/transports/redis.transport.js';
export type { RedisTransportOptions } from './services/transports/redis.transport.js';
export { CallbackTransport } from './services/transports/callback.transport.js';
export { TelegramTransport } from './services/transports/telegram.transport.js';
export type { TelegramTransportOptions } from './services/transports/telegram.transport.js';
export {
  registerVersionToRedis,
  startHeartbeat,
  registerProjectInRedis,
} from './utils/registration.js';
