import { ConfigService } from './services/config.service.js';
import { LoggerService } from './services/logger.service.js';
import { DatabaseService } from './services/database.service.js';
import { WebSocketService } from './services/websocket.service.js';
import { CronService } from './services/cron.service.js';
import { CacheService } from './services/cache.service.js';
import { RegistryService } from './services/registry.service.js';
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
  HealthCheckResult,
  ServiceInfo,
} from './types.js';

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

  /**
   * Private constructor to enforce singleton pattern
   * Does NOT initialize services - call init() first
   */
  private constructor() {
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
   * // With logger config
   * await katax.init({
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

    this._config = new ConfigService();
    this._logger = new LoggerService(config?.logger);
    // Determine app name with priority: explicit config, env KATAX_APP_NAME, npm_package_name, package.json
    const explicitAppName = config?.appName;
    const envApp = process.env['KATAX_APP_NAME'] ?? process.env['npm_package_name'];
    const detectedAppName = explicitAppName ?? envApp ?? this._appName ?? undefined;
    if (detectedAppName) {
      try {
        this._logger.setAppName(detectedAppName);
        // also update internal app name so katax.appName reflects final value
        this._appName = detectedAppName;
      } catch {
        // ignore failures setting app name on logger
      }
    }
    this._cronService = new CronService();
    await this._cronService.init();
    this._initialized = true;

    this._logger.info({ message: 'Katax initialized (config, logger, cron ready)' });

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
      }
    }

    return this;
  }

  /**
   * Ensure Katax is initialized before accessing services
   * @throws Error if init() has not been called
   */
  private ensureInitialized(): void {
    if (!this._initialized) {
      throw new Error(
        'Katax not initialized. Call katax.init() before using any services.\n' +
          'Example: await katax.init(); // or katax.init().then(() => {...})'
      );
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
      throw new Error('Database name is required');
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
      throw new Error(`Database '${config.name}' initialization failed: ${errorMessage}`);
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
      throw new Error('WebSocket name is required');
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
      throw new Error(`WebSocket '${config.name}' initialization failed: ${errorMessage}`);
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
    return this._config!;
  }

  /**
   * Get the logger service
   * @throws Error if init() has not been called
   */
  public get logger(): ILoggerService {
    this.ensureInitialized();
    return this._logger!;
  }

  /**
   * Get the Cron service for advanced operations
   * (stopAll, getJobs, startJob, stopJob, removeJob)
   * @throws Error if init() has not been called
   */
  public get cronService(): ICronService {
    this.ensureInitialized();
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
    const db = this._databases.get(name);
    if (!db) {
      throw new Error(
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
    const socket = this._sockets.get(name);
    if (!socket) {
      throw new Error(
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

    // Return cached instance if exists
    if (this._cacheInstances.has(redisName)) {
      return this._cacheInstances.get(redisName)!;
    }

    const redis = this._databases.get(redisName);

    if (!redis) {
      throw new Error(
        `Redis connection '${redisName}' not found. Create it first using katax.database()`
      );
    }

    if (redis.config?.type !== 'redis') {
      throw new Error(
        `Database '${redisName}' is not a Redis connection (type: ${redis.config?.type})`
      );
    }

    const cacheInstance = new CacheService(redis);
    this._cacheInstances.set(redisName, cacheInstance);
    return cacheInstance;
  }

  /**
   * Check if Katax has been initialized
   */
  public get isInitialized(): boolean {
    return this._initialized;
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
   * @example
   * katax.env('PORT') // '3000'
   * katax.env('PORT', '8080') // '8080' if PORT not set
   * katax.env('DEBUG', false) // false if DEBUG not set
   */
  public env<T extends string | number | boolean = string>(key: string, defaultValue?: T): T {
    const value = process.env[key];

    if (value === undefined) {
      return (defaultValue ?? '') as T;
    }

    // Try to parse to the expected type based on defaultValue
    if (typeof defaultValue === 'number') {
      return Number(value) as T;
    }
    if (typeof defaultValue === 'boolean') {
      return (value === 'true' || value === '1') as unknown as T;
    }

    return value as T;
  }

  /**
   * Require an environment variable (throws if not set)
   * @example const secret = katax.envRequired('JWT_SECRET');
   */
  public envRequired(key: string): string {
    const value = process.env[key];
    if (value === undefined || value === '') {
      throw new Error(`Required environment variable '${key}' is not set`);
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

    const result: HealthCheckResult = {
      status: 'healthy',
      services: {
        databases: {},
        sockets: {},
        cron: true,
      },
      timestamp: Date.now(),
    };

    // Check all databases
    for (const [name, db] of this._databases) {
      try {
        // Try a simple query to verify connection
        if (db.config?.type === 'redis') {
          await db.redis?.('PING');
        } else if (db.config?.type === 'mongodb') {
          // MongoDB client ping
          const client = await db.getClient();
          await (client as { db: () => { command: (cmd: object) => Promise<unknown> } })
            .db()
            .command({ ping: 1 });
        } else {
          // SQL databases
          await db.query('SELECT 1');
        }
        result.services.databases[name] = true;
      } catch {
        result.services.databases[name] = false;
        result.status = 'degraded';
      }
    }

    // Check all sockets (just verify they're initialized)
    for (const [name, socket] of this._sockets) {
      try {
        const server = (socket as { getServer?: () => unknown }).getServer?.();
        result.services.sockets[name] = server !== null;
      } catch {
        result.services.sockets[name] = false;
        result.status = 'degraded';
      }
    }

    // Check cron service
    try {
      this._cronService!.getJobs();
      result.services.cron = true;
    } catch {
      result.services.cron = false;
      result.status = 'degraded';
    }

    // If any database is down, mark as degraded
    const allDbsHealthy = Object.values(result.services.databases).every((v) => v);
    const allSocketsHealthy = Object.values(result.services.sockets).every((v) => v);

    if (!allDbsHealthy || !allSocketsHealthy || !result.services.cron) {
      result.status = 'degraded';
    }

    // If NO databases are healthy and there are databases configured, mark unhealthy
    if (this._databases.size > 0 && !Object.values(result.services.databases).some((v) => v)) {
      result.status = 'unhealthy';
    }

    return result;
  }

  /**
   * Gracefully shutdown all services
   * Uses Promise.allSettled to ensure all services attempt to close even if some fail
   */
  public async shutdown(): Promise<void> {
    if (!this._initialized) {
      return;
    }

    this._logger!.info({ message: 'Shutting down Katax services...' });
    const errors: Array<{ service: string; error: unknown }> = [];

    // Close all database connections in parallel
    if (this._databases.size > 0) {
      this._logger!.info({ message: `Closing ${this._databases.size} database connection(s)...` });
      const dbCloseResults = await Promise.allSettled(
        Array.from(this._databases.entries()).map(async ([name, db]) => {
          await db.close();
          return name;
        })
      );

      for (const result of dbCloseResults) {
        if (result.status === 'fulfilled') {
          this._logger!.info({ message: `Database '${result.value}' closed` });
        } else {
          this._logger!.error({ message: 'Failed to close database', err: result.reason });
          errors.push({ service: 'database', error: result.reason });
        }
      }
      this._databases.clear();
    }

    // Close all WebSocket servers in parallel
    if (this._sockets.size > 0) {
      this._logger!.info({ message: `Closing ${this._sockets.size} WebSocket server(s)...` });
      const socketCloseResults = await Promise.allSettled(
        Array.from(this._sockets.entries()).map(async ([name, socket]) => {
          await socket.close();
          return name;
        })
      );

      for (const result of socketCloseResults) {
        if (result.status === 'fulfilled') {
          this._logger!.info({ message: `WebSocket '${result.value}' closed` });
        } else {
          this._logger!.error({ message: 'Failed to close WebSocket', err: result.reason });
          errors.push({ service: 'websocket', error: result.reason });
        }
      }
      this._sockets.clear();
    }

    // Stop all cron jobs (synchronous, no need for Promise.allSettled)
    try {
      this._cronService!.stopAll();
      this._logger!.info({ message: 'Cron jobs stopped' });
    } catch (error) {
      this._logger!.error({ message: 'Failed to stop cron jobs', err: error });
      errors.push({ service: 'cron', error });
    }

    // Unregister from registry
    if (this._registry) {
      try {
        await this._registry.unregister();
        this._logger!.info({ message: 'Unregistered from registry' });
      } catch (error) {
        this._logger!.error({ message: 'Failed to unregister from registry', err: error });
        errors.push({ service: 'registry', error });
      }
      this._registry = null;
    }

    this._initialized = false;

    if (errors.length > 0) {
      this._logger!.warn({ message: `Shutdown completed with ${errors.length} error(s)` });
    } else {
      this._logger!.info({ message: '✓ Katax services shutdown complete' });
    }
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
      Katax.instance._databases.clear();
      Katax.instance._sockets.clear();
      Katax.instance._cacheInstances.clear();
    }
    Katax.instance = null;
  }
}

// Export singleton instance for direct import
export const katax = Katax.getInstance();
