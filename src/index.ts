/**
 * Katax Service Manager
 * Runtime service container for Node.js applications
 */

export { Katax, katax } from './katax.js';

// Export types
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
  LogMessage,
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
  IWebSocketService,
  ICronService,
} from './types.js';

// Export service classes (for advanced usage)
export { ConfigService } from './services/config.service.js';
export { LoggerService } from './services/logger.service.js';
export { DatabaseService } from './services/database.service.js';
export { WebSocketService } from './services/websocket.service.js';
export { CronService } from './services/cron.service.js';
export { CacheService } from './services/cache.service.js';
export { RegistryService } from './services/registry.service.js';
export { RedisTransport } from './services/transports/redis.transport.js';
export { CallbackTransport } from './services/transports/callback.transport.js';
export {
  registerVersionToRedis,
  startHeartbeat,
  registerProjectInRedis,
} from './utils/registration.js';
