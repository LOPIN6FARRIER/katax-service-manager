import { LoggerService } from './services/logger.service.js';
import { DatabaseService } from './services/database.service.js';
import { WebSocketService } from './services/websocket.service.js';
import { CacheService } from './services/cache.service.js';
import { RegistryService } from './services/registry.service.js';
import { BootstrapService } from './services/bootstrap.service.js';
import { HealthService } from './services/health.service.js';
import { LifecycleService } from './services/lifecycle.service.js';
import {
  RedisStreamBridgeService,
  type RedisStreamBridgeConfig,
} from './services/redis-stream-bridge.service.js';
import { startHeartbeat } from './utils/registration.js';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type {
  IConfigService,
  ILoggerService,
  IDatabaseService,
  IWebSocketService,
  ICronService,
  CronJobConfig,
  DatabaseConfig,
  WebSocketConfig,
  KataxInitConfig,
  KataxLifecycleHooks,
  HealthCheckResult,
  ServiceInfo,
} from './types.js';
import {
  KataxConfigError,
  KataxDatabaseError,
  KataxNotInitializedError,
  KataxRedisError,
  KataxWebSocketError,
} from './errors.js';

/**
 * Katax Service Manager
 * Singleton pattern for managing shared services across the application
 *
 * @example
 * // In your main entry file (index.ts)
 * import { katax } from 'katax-service-manager';
 *
 * katax.init().then(async () => {
 *   await katax.database({ name: 'main', type: 'postgresql', connection: {...} });
 *   katax.cron({ name: 'cleanup', schedule: '0 2 * * *', task: cleanupFn });
 *   app.listen(3000);
 * });
 *
 * // In any controller/service
 * import { katax } from 'katax-service-manager';
 * const db = katax.db('main');
 * const result = await db.query('SELECT * FROM users');
 */
export class Katax {
  private static instance: Katax | null = null;
  private _initialized = false;

  // App info from package.json (loaded once)
  private _appName: string = 'unknown';
  private _appVersion: string = '0.0.0';

  // Services (initialized lazily via init())
  private _config: IConfigService | null = null;
  private _logger: ILoggerService | null = null;
  private _cronService: ICronService | null = null;
  private _registry: RegistryService | null = null;
  private _databases: Map<string, IDatabaseService> = new Map();
  private _sockets: Map<string, IWebSocketService> = new Map();

  // Pending initialization promises (prevents race conditions)
  private _pendingDatabases: Map<string, Promise<IDatabaseService>> = new Map();
  private _pendingSockets: Map<string, Promise<IWebSocketService>> = new Map();

  // Cache instances (reused)
  private _cacheInstances: Map<string, CacheService> = new Map();
  private _bridges: Map<string, RedisStreamBridgeService> = new Map();
  private _heartbeats: Array<{ stop: () => void }> = [];
  private _overrides: Map<string, unknown> = new Map();
  private _hooks: KataxLifecycleHooks | null = null;
  private _shutdownHooks: Array<() => Promise<void> | void> = [];
  private _processHandlersRegistered = false;
  private readonly _bootstrapService = new BootstrapService();
  private readonly _healthService = new HealthService();
  private readonly _lifecycleService = new LifecycleService();

  /**
   * Creates a Katax instance (instantiable mode)
   * Does NOT initialize services - call init() first
   *
   * @example
   * const katax = new Katax();
   * await katax.init();
   */
  public constructor() {
    // Load package.json info immediately
    this.loadPackageJson();
  }

  /**
   * Load app name and version from package.json
   */
  private loadPackageJson(): void {
    const packagePath = join(process.cwd(), 'package.json');

    if (!existsSync(packagePath)) {
      return;
    }

    try {
      const content = readFileSync(packagePath, 'utf-8');
      const pkg = JSON.parse(content) as { name?: string; version?: string };
      this._appName = pkg.name ?? 'unknown';
      this._appVersion = pkg.version ?? '0.0.0';
    } catch {
      // Silently fail - defaults already set
    }
  }

  /**
   * Initialize Katax services (config, logger, cron)
   * MUST be called before using any other method
   *
   * @param config - Optional configuration for services
   * @returns Promise<Katax> - Returns this instance for chaining
   *
   * @example
   * // Basic init
   * await katax.init();
   *
   * // With auto-loading .env
   * await katax.init({ loadEnv: true });
   *
   * // With logger config
   * await katax.init({
   *   loadEnv: true,
   *   logger: {
   *     level: 'debug',
   *     prettyPrint: true
   *   }
   * });
   *
   * // With .then()
   * katax.init({ logger: { level: 'debug' } }).then((k) => {
   *   k.logger.info({ message: 'Ready!' });
   *   app.listen(3000);
   * });
   *
   * // With registry auto-registration
   * await katax.init({
   *   registry: {
   *     url: 'https://my-dashboard.com/api/services',
   *     apiKey: process.env.REGISTRY_API_KEY
   *   }
   * });
   */
  public async init(config?: KataxInitConfig): Promise<Katax> {
    if (this._initialized) {
      return this;
    }

    // Load .env if requested (before any env access)
    if (config?.loadEnv) {
      try {
        // @ts-expect-error - dotenv is an optional peer dependency
        const dotenv = await import('dotenv');
        dotenv.config();
      } catch (error) {
        throw new KataxConfigError(
          'loadEnv: true requires "dotenv" to be installed.\n' + 'Run: npm install dotenv'
        );
      }
    }

    this._hooks = config?.hooks ?? null;
    await this._hooks?.beforeInit?.();

    // Pass existing logger to bootstrap so it's reused instead of replaced
    const bootstrapResult = await this._bootstrapService.initialize(
      config,
      this._appName,
      this._logger ?? undefined
    );
    this._config = bootstrapResult.config;
    this._logger = bootstrapResult.logger;
    this._cronService = bootstrapResult.cronService;
    this._appName = bootstrapResult.resolvedAppName;

    this._initialized = true;

    this._logger.info({ message: 'Katax initialized (config, logger, cron ready)' });

    // Register process signal handlers (SIGTERM, SIGINT)
    this.registerProcessHandlers();

    // Register with registry if configured
    if (config?.registry) {
      try {
        this._registry = new RegistryService(config.registry, this._logger);
        await this._registry.register();
      } catch (error) {
        // Registry is optional - warn but don't fail
        this._logger.warn({
          message: 'Failed to register with registry, continuing without it',
          err: error,
        });
        await this._hooks?.onError?.('registry.register', error);
      }
    }

    await this._hooks?.afterInit?.();

    return this;
  }

  /**
   * Ensure Katax is initialized before accessing services
   * @throws Error if init() has not been called
   */
  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new KataxNotInitializedError();
    }
  }

  /**
   * Get the singleton instance of Katax
   */
  public static getInstance(): Katax {
    if (!Katax.instance) {
      Katax.instance = new Katax();
    }
    return Katax.instance;
  }

  /**
   * Override an internal service by key (useful for tests/mocks)
   *
   * Supported keys examples:
   * - 'config'
   * - 'logger'
   * - 'cron'
   * - 'db:main'
   * - 'ws:events'
   * - 'cache:cache'
   */
  public overrideService<T>(key: string, service: T): void {
    this._overrides.set(key, service);
  }

  /**
   * Remove a specific override, or all overrides if no key is provided
   */
  public clearOverride(key?: string): void {
    if (key) {
      this._overrides.delete(key);
      return;
    }
    this._overrides.clear();
  }

  private getOverride<T>(key: string): T | undefined {
    return this._overrides.get(key) as T | undefined;
  }

  /**
   * Create or retrieve a database connection
   * If a database with the same name already exists, returns the existing instance
   *
   * @example
   * const pg = await katax.database({
   *   name: 'main',
   *   type: 'postgresql',
   *   connection: { host: 'localhost', port: 5432, ... }
   * });
   *
   * // Later, in any controller:
   * const db = katax.db('main');  // Quick access
   *
   * // Optional database (app continues if connection fails):
   * const optionalDb = await katax.database({
   *   name: 'analytics',
   *   type: 'postgresql',
   *   required: false,  // Returns null on failure instead of throwing
   *   connection: { ... }
   * });
   * if (optionalDb) {
   *   // use database
   * }
   */
  public async database(config: DatabaseConfig): Promise<IDatabaseService | null> {
    this.ensureInitialized();

    // Validate name is provided
    if (!config.name) {
      throw new KataxDatabaseError('Database name is required');
    }

    const dbOverride = this.getOverride<IDatabaseService>(`db:${config.name}`);
    if (dbOverride) {
      this._logger!.debug({
        message: `Database '${config.name}' override found, returning mocked instance`,
      });
      return dbOverride;
    }

    // Check if database with this name already exists
    if (this._databases.has(config.name)) {
      this._logger!.debug({
        message: `Database '${config.name}' already exists, returning existing instance`,
      });
      return this._databases.get(config.name)!;
    }

    // Check if database is currently being initialized (prevent race condition)
    if (this._pendingDatabases.has(config.name)) {
      this._logger!.debug({
        message: `Database '${config.name}' initialization in progress, waiting...`,
      });
      return this._pendingDatabases.get(config.name)!;
    }

    // Create and track the initialization promise
    const initPromise = this.createDatabase(config);
    this._pendingDatabases.set(config.name, initPromise);

    try {
      const db = await initPromise;
      this._databases.set(config.name, db);
      this._logger!.info({ message: `Database '${config.name}' connected successfully` });
      return db;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // If required is explicitly false, log warning and return null instead of throwing
      if (config.required === false) {
        this._logger!.warn({
          message: `Database '${config.name}' connection failed (non-required), continuing without it`,
          err: error,
        });
        return null;
      }

      // Default behavior: throw error (fail-fast)
      this._logger!.error({ message: `Failed to create database '${config.name}'`, err: error });
      throw new KataxDatabaseError(
        `Database '${config.name}' initialization failed: ${errorMessage}`,
        { name: config.name, type: config.type }
      );
    } finally {
      this._pendingDatabases.delete(config.name);
    }
  }

  /**
   * Internal method to create database connection
   */
  private async createDatabase(config: DatabaseConfig): Promise<IDatabaseService> {
    this._logger!.info({
      message: `Creating ${config.type} database connection '${config.name}'...`,
    });
    const db = new DatabaseService(config);
    await db.init();
    return db;
  }

  /**
   * Create or retrieve a WebSocket server
   * If a WebSocket with the same name already exists, returns the existing instance
   *
   * @example
   * const mainSocket = await katax.socket({
   *   name: 'main',
   *   port: 3001,
   *   cors: { origin: '*' }
   * });
   *
   * const adminSocket = await katax.socket({
   *   name: 'admin',
   *   port: 3002,
   *   enableAuth: true
   * });
   */
  public async socket(config: WebSocketConfig): Promise<IWebSocketService> {
    this.ensureInitialized();

    // Validate name is provided
    if (!config.name) {
      throw new KataxWebSocketError('WebSocket name is required');
    }

    const socketOverride = this.getOverride<IWebSocketService>(`ws:${config.name}`);
    if (socketOverride) {
      this._logger!.debug({
        message: `WebSocket '${config.name}' override found, returning mocked instance`,
      });
      return socketOverride;
    }

    // Check if socket with this name already exists
    if (this._sockets.has(config.name)) {
      this._logger!.debug({
        message: `WebSocket '${config.name}' already exists, returning existing instance`,
      });
      return this._sockets.get(config.name)!;
    }

    // Check if socket is currently being initialized (prevent race condition)
    if (this._pendingSockets.has(config.name)) {
      this._logger!.debug({
        message: `WebSocket '${config.name}' initialization in progress, waiting...`,
      });
      return this._pendingSockets.get(config.name)!;
    }

    // Create and track the initialization promise
    const initPromise = this.createSocket(config);
    this._pendingSockets.set(config.name, initPromise);

    try {
      const socket = await initPromise;
      this._sockets.set(config.name, socket);

      // Log appropriate message based on mode
      if (config.httpServer) {
        this._logger!.info({
          message: `WebSocket server '${config.name}' attached to HTTP server (shared port)`,
        });
      } else {
        this._logger!.info({
          message: `WebSocket server '${config.name}' running on port ${config.port ?? 3001}`,
        });
      }
      return socket;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this._logger!.error({ message: `Failed to create WebSocket '${config.name}'`, err: error });
      throw new KataxWebSocketError(
        `WebSocket '${config.name}' initialization failed: ${errorMessage}`,
        { name: config.name }
      );
    } finally {
      this._pendingSockets.delete(config.name);
    }
  }

  /**
   * Internal method to create WebSocket server
   */
  private async createSocket(config: WebSocketConfig): Promise<IWebSocketService> {
    if (config.httpServer) {
      this._logger!.info({
        message: `Creating WebSocket server '${config.name}' (attached to HTTP server)...`,
      });
    } else {
      this._logger!.info({
        message: `Creating WebSocket server '${config.name}' on port ${config.port ?? 3001}...`,
      });
    }
    const socket = new WebSocketService(config);
    await socket.init();

    // Connect logger to first socket for broadcasting
    if (this._sockets.size === 0) {
      (this._logger as LoggerService).setSocketService(socket);
      this._logger!.debug({ message: 'Logger connected to WebSocket for broadcasting' });
    }

    return socket;
  }

  /**
   * Get the configuration service
   * @throws Error if init() has not been called
   */
  public get config(): IConfigService {
    this.ensureInitialized();
    const configOverride = this.getOverride<IConfigService>('config');
    if (configOverride) {
      return configOverride;
    }
    return this._config!;
  }

  /**
   * Get the logger service
   * Logger is always available, even before init() for simple console logging
   * Advanced features (broadcast, transports) require init()
   */
  public get logger(): ILoggerService {
    // Check for override first
    const loggerOverride = this.getOverride<ILoggerService>('logger');
    if (loggerOverride) {
      return loggerOverride;
    }

    // Create default logger if not initialized yet (lazy initialization)
    if (!this._logger) {
      this._logger = new LoggerService({
        level: 'info',
        prettyPrint: this.isDev,
        enableBroadcast: false, // No broadcast until init()
      });
    }

    return this._logger;
  }

  /**
   * Get the Cron service for advanced operations
   * (stopAll, getJobs, startJob, stopJob, removeJob)
   * @throws Error if init() has not been called
   */
  public get cronService(): ICronService {
    this.ensureInitialized();
    const cronOverride = this.getOverride<ICronService>('cron');
    if (cronOverride) {
      return cronOverride;
    }
    return this._cronService!;
  }

  /**
   * Get a database connection by name (shortcut for common use case)
   * Use this in controllers/services to access databases created during init
   *
   * @param name - The database name used when creating with katax.database()
   * @returns The database service
   * @throws Error if database not found or Katax not initialized
   *
   * @example
   * // In controller
   * import { katax } from 'katax-service-manager';
   *
   * const db = katax.db('main');
   * const users = await db.query('SELECT * FROM users');
   */
  public db(name: string): IDatabaseService {
    this.ensureInitialized();
    const dbOverride = this.getOverride<IDatabaseService>(`db:${name}`);
    if (dbOverride) {
      return dbOverride;
    }
    const db = this._databases.get(name);
    if (!db) {
      throw new KataxDatabaseError(
        `Database '${name}' not found. Available: [${Array.from(this._databases.keys()).join(', ')}]`
      );
    }
    return db;
  }

  /**
   * Get a WebSocket server by name (shortcut)
   *
   * @param name - The socket name used when creating with katax.socket()
   * @returns The WebSocket service
   * @throws Error if socket not found or Katax not initialized
   */
  public ws(name: string): IWebSocketService {
    this.ensureInitialized();
    const wsOverride = this.getOverride<IWebSocketService>(`ws:${name}`);
    if (wsOverride) {
      return wsOverride;
    }
    const socket = this._sockets.get(name);
    if (!socket) {
      throw new KataxWebSocketError(
        `WebSocket '${name}' not found. Available: [${Array.from(this._sockets.keys()).join(', ')}]`
      );
    }
    return socket;
  }

  /**
   * Add a cron job
   * Convenient method to add jobs using katax.cron({ name, schedule, task })
   *
   * @example
   * katax.cron({
   *   name: 'my-job',
   *   schedule: '* * * * *',
   *   task: () => console.log('Running...')
   * });
   */
  public cron(job: CronJobConfig): void {
    this.ensureInitialized();
    this._cronService!.addJob(job);
  }

  /**
   * Create a cache service instance using a Redis connection
   * Instances are cached and reused for the same Redis connection
   *
   * @param redisName - Name of the Redis database connection (default: 'cache')
   * @returns CacheService instance with high-level cache operations
   *
   * @example
   * const redis = await katax.database({
   *   name: 'cache',
   *   type: 'redis',
   *   connection: { host: 'localhost', port: 6379 }
   * });
   *
   * const cache = katax.cache('cache');
   * await cache.set('user:123', user, 3600);
   * const cached = await cache.get<User>('user:123');
   */
  public cache(redisName: string = 'cache'): CacheService {
    this.ensureInitialized();

    const cacheOverride = this.getOverride<CacheService>(`cache:${redisName}`);
    if (cacheOverride) {
      return cacheOverride;
    }

    // Return cached instance if exists
    if (this._cacheInstances.has(redisName)) {
      return this._cacheInstances.get(redisName)!;
    }

    const redis = this._databases.get(redisName);

    if (!redis) {
      throw new KataxRedisError(
        `Redis connection '${redisName}' not found. Create it first using katax.database()`
      );
    }

    if (redis.config?.type !== 'redis') {
      throw new KataxRedisError(
        `Database '${redisName}' is not a Redis connection (type: ${redis.config?.type})`
      );
    }

    const cacheInstance = new CacheService(redis);
    this._cacheInstances.set(redisName, cacheInstance);
    return cacheInstance;
  }

  /**
   * Create a Redis Stream Bridge for broadcasting logs from Redis to WebSocket
   * Instances are cached and reused for the same configuration.
   * Each bridge filters logs by appName to support multiple apps using the same Redis.
   *
   * @param redisName - Name of the Redis database connection (default: 'redis')
   * @param socketName - Name of the WebSocket connection (default: 'main')
   * @param config - Bridge configuration (appName is required)
   * @returns RedisStreamBridgeService instance
   *
   * @example
   * // Create bridge for trade-alerts app
   * const bridge = katax.bridge('redis', 'main', {
   *   appName: 'trade-alerts'
   * });
   * await bridge.start();
   *
   * @example
   * // With custom configuration
   * const bridge = katax.bridge('redis', 'main', {
   *   appName: 'trade-alerts',
   *   streamKey: 'katax:logs',
   *   batchSize: 20
   * });
   * await bridge.start();
   *
   * // Stop when shutting down
   * process.on('SIGTERM', () => bridge.stop());
   */
  public bridge(
    redisName: string = 'redis',
    socketName: string = 'main',
    config: RedisStreamBridgeConfig
  ): RedisStreamBridgeService {
    this.ensureInitialized();

    const bridgeKey = `${redisName}:${socketName}:${config.streamKey ?? 'katax:logs'}:${config.appName}`;

    // Return cached instance if exists
    if (this._bridges.has(bridgeKey)) {
      return this._bridges.get(bridgeKey)!;
    }

    const redis = this._databases.get(redisName);
    if (!redis) {
      throw new KataxRedisError(
        `Redis connection '${redisName}' not found. Create it first using katax.database()`
      );
    }

    if (redis.config?.type !== 'redis') {
      throw new KataxRedisError(
        `Database '${redisName}' is not a Redis connection (type: ${redis.config?.type})`
      );
    }

    const socket = this._sockets.get(socketName);
    if (!socket) {
      throw new KataxWebSocketError(
        `WebSocket '${socketName}' not found. Create it first using katax.socket()`
      );
    }

    const bridge = new RedisStreamBridgeService(redis, socket, config);
    this._bridges.set(bridgeKey, bridge);
    return bridge;
  }

  /**
   * Check if Katax has been initialized
   */
  public get isInitialized(): boolean {
    return this._initialized;
  }

  /**
   * Start a managed heartbeat that automatically stops on shutdown
   *
   * @param opts - Heartbeat configuration
   * @param redisName - Name of the Redis database (default: 'redis')
   * @param socketName - Optional name of WebSocket service for broadcasting heartbeats
   * @returns Heartbeat controller with stop() method
   *
   * @example
   * // Basic heartbeat
   * katax.heartbeat({
   *   app: katax.appName,
   *   port: 3000,
   * });
   *
   * // With WebSocket broadcasting
   * katax.heartbeat({
   *   app: katax.appName,
   *   port: 3000,
   *   version: katax.version,
   * }, 'cache', 'main');
   */
  public heartbeat(
    opts: {
      app: string;
      port?: number | string;
      intervalMs?: number;
      ttlSeconds?: number;
      version?: string;
    },
    redisName: string = 'redis',
    socketName?: string
  ): { stop: () => void } {
    this.ensureInitialized();

    const redis = this._databases.get(redisName);
    if (!redis) {
      throw new KataxRedisError(
        `Redis connection '${redisName}' not found. Create it first using katax.database()`
      );
    }

    if (redis.config?.type !== 'redis') {
      throw new KataxRedisError(
        `Database '${redisName}' is not a Redis connection (type: ${redis.config?.type})`
      );
    }

    const socket = socketName ? this._sockets.get(socketName) : undefined;
    if (socketName && !socket) {
      this._logger?.warn({
        message: `WebSocket '${socketName}' not found. Heartbeat will run without broadcasting.`,
      });
    }

    const hb = startHeartbeat(redis, opts, socket);
    this._heartbeats.push(hb);
    return hb;
  }

  // ==================== APP INFO ====================

  /**
   * Get the app name from package.json
   * @example katax.appName // 'api-blog'
   */
  public get appName(): string {
    return this._appName;
  }

  /**
   * Get the app version from package.json
   * @example katax.version // '1.0.0'
   */
  public get version(): string {
    return this._appVersion;
  }

  /**
   * Check if running in development mode (NODE_ENV === 'development' or not set)
   * @example if (katax.isDev) { enableDebugMode(); }
   */
  public get isDev(): boolean {
    const env = process.env['NODE_ENV']?.toLowerCase();
    return !env || env === 'development';
  }

  /**
   * Check if running in production mode (NODE_ENV === 'production')
   * @example if (katax.isProd) { enableCaching(); }
   */
  public get isProd(): boolean {
    return process.env['NODE_ENV']?.toLowerCase() === 'production';
  }

  /**
   * Check if running in test mode (NODE_ENV === 'test')
   * @example if (katax.isTest) { useMockDb(); }
   */
  public get isTest(): boolean {
    return process.env['NODE_ENV']?.toLowerCase() === 'test';
  }

  /**
   * Get current NODE_ENV value
   * @example katax.nodeEnv // 'production'
   */
  public get nodeEnv(): string {
    return process.env['NODE_ENV'] ?? 'development';
  }

  /**
   * Get an environment variable with optional default
   * Type is inferred from the default value
   *
   * @example
   * katax.env('PORT')              // string | ''
   * katax.env('PORT', '8080')      // string (type: string)
   * katax.env('PORT', 3000)        // number (type: number)
   * katax.env('DEBUG', false)      // boolean (type: boolean)
   */
  public env(key: string): string;
  public env(key: string, defaultValue: string): string;
  public env(key: string, defaultValue: number): number;
  public env(key: string, defaultValue: boolean): boolean;
  public env(key: string, defaultValue?: string | number | boolean): string | number | boolean {
    const value = process.env[key];

    if (value === undefined) {
      return defaultValue ?? '';
    }

    // Infer type from defaultValue
    if (typeof defaultValue === 'number') {
      const parsed = Number(value);
      return isNaN(parsed) ? defaultValue : parsed;
    }
    if (typeof defaultValue === 'boolean') {
      return value === 'true' || value === '1';
    }

    return value;
  }

  /**
   * Require an environment variable (throws if not set)
   * @example const secret = katax.envRequired('JWT_SECRET');
   */
  public envRequired(key: string): string {
    const value = process.env[key];
    if (value === undefined || value === '') {
      throw new KataxConfigError(`Required environment variable '${key}' is not set`, {
        key,
      });
    }
    return value;
  }

  /**
   * Check if registered with registry
   */
  public get isRegistered(): boolean {
    return this._registry?.isRegistered ?? false;
  }

  /**
   * Get current service info (from package.json + system metrics)
   * Useful for debugging or custom health endpoints
   *
   * @returns ServiceInfo with name, version, hostname, memory, uptime, etc.
   */
  public getServiceInfo(): ServiceInfo | null {
    return this._registry?.getServiceInfo() ?? null;
  }

  /**
   * Check health status of all services
   * Useful for health check endpoints in your API
   *
   * @returns Health check result with status of each service
   *
   * @example
   * // In your Express/Fastify API
   * app.get('/api/health', async (req, res) => {
   *   const health = await katax.healthCheck();
   *   const statusCode = health.status === 'healthy' ? 200 :
   *                      health.status === 'degraded' ? 503 : 500;
   *   res.status(statusCode).json(health);
   * });
   */
  public async healthCheck(): Promise<HealthCheckResult> {
    this.ensureInitialized();
    return this._healthService.check(this._databases, this._sockets, this._cronService!);
  }

  /**
   * Register a shutdown hook to run custom cleanup logic
   * Hooks are called before Katax tears down services
   *
   * @param fn - Async or sync function to run on shutdown
   *
   * @example
   * katax.onShutdown(async () => {
   *   await closeCustomConnection();
   *   console.log('Custom cleanup done');
   * });
   */
  public onShutdown(fn: () => Promise<void> | void): void {
    this._shutdownHooks.push(fn);
  }

  /**
   * Register process signal handlers for graceful shutdown
   * Called automatically during init()
   * @internal
   */
  private registerProcessHandlers(): void {
    if (this._processHandlersRegistered) {
      return;
    }

    const shutdown = async (signal: string) => {
      this._logger?.info({ message: `Received ${signal}, shutting down gracefully...` });
      await this.shutdown();
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    this._processHandlersRegistered = true;
    this._logger?.debug({ message: 'Process signal handlers registered (SIGTERM, SIGINT)' });
  }

  /**
   * Gracefully shutdown all services
   * Uses Promise.allSettled to ensure all services attempt to close even if some fail
   */
  public async shutdown(): Promise<void> {
    if (!this._initialized) {
      return;
    }

    // Run user-defined shutdown hooks first
    if (this._shutdownHooks.length > 0) {
      this._logger?.info({ message: `Running ${this._shutdownHooks.length} shutdown hook(s)...` });
      await Promise.allSettled(
        this._shutdownHooks.map(async (hook) => {
          try {
            await hook();
          } catch (error) {
            this._logger?.error({ message: 'Shutdown hook failed', err: error });
          }
        })
      );
    }

    const shutdownResult = await this._lifecycleService.shutdown({
      logger: this._logger!,
      databases: this._databases,
      sockets: this._sockets,
      cronService: this._cronService!,
      registry: this._registry,
      hooks: this._hooks,
    });
    this._registry = shutdownResult.registry;

    // Stop all Redis Stream Bridges
    for (const bridge of this._bridges.values()) {
      try {
        bridge.stop();
      } catch (error) {
        this._logger?.warn({ message: 'Failed to stop bridge', error });
      }
    }
    this._bridges.clear();

    // Stop all heartbeats
    for (const hb of this._heartbeats) {
      try {
        hb.stop();
      } catch (error) {
        this._logger?.warn({ message: 'Failed to stop heartbeat', error });
      }
    }
    this._heartbeats = [];

    this._initialized = false;
  }

  /**
   * Reset the singleton instance (mainly for testing)
   * Also clears initialization state
   */
  public static reset(): void {
    if (Katax.instance) {
      Katax.instance._initialized = false;
      Katax.instance._config = null;
      Katax.instance._logger = null;
      Katax.instance._cronService = null;
      Katax.instance._registry = null;
      Katax.instance._hooks = null;
      Katax.instance._overrides.clear();
      Katax.instance._databases.clear();
      Katax.instance._sockets.clear();
      Katax.instance._cacheInstances.clear();
      Katax.instance._bridges.clear();
      Katax.instance._heartbeats = [];
    }
    Katax.instance = null;
  }
}

// Export singleton instance for direct import
export const katax = Katax.getInstance();
