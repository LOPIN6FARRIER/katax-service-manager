/**
 * Configuration options for the Katax service manager
 */
export interface KataxConfig {
  /**
   * Logger configuration
   */
  logger?: LoggerConfig;

  /**
   * Database configuration
   */
  database?: DatabaseConfig;

  /**
   * WebSocket configuration
   */
  websocket?: WebSocketConfig;

  /**
   * Cron jobs configuration
   */
  cron?: CronConfig;
}

/**
 * Configuration for katax.init()
 */
export interface KataxInitConfig {
  /**
   * Logger configuration
   */
  logger?: LoggerConfig;

  /**
   * Optional application name override. If not provided, Katax will try
   * `process.env.KATAX_APP_NAME`, then `process.env.npm_package_name`, then
   * `package.json` in `process.cwd()`.
   */
  appName?: string;

  /**
   * Lifecycle hooks for initialization and shutdown
   */
  hooks?: KataxLifecycleHooks;

  /**
   * Registry/Dashboard configuration
   * When provided, katax will auto-register with your registry via HTTP
   */
  registry?: RegistryConfig;
}

/**
 * Custom registry callbacks to integrate with any destination
 * (API, database, queue, etc.)
 */
export interface RegistryHandler {
  register?: (serviceInfo: ServiceInfo) => Promise<void>;
  heartbeat?: (serviceInfo: ServiceInfo) => Promise<void>;
  unregister?: (payload: RegistryUnregisterPayload) => Promise<void>;
}

export interface RegistryUnregisterPayload {
  name: string;
  version: string;
  hostname: string;
  pid: number;
  timestamp: number;
}

/**
 * Registry configuration for service registration
 * Uses HTTP POST (no extra dependencies)
 */
export interface RegistryConfig {
  /**
   * Base URL of the registry API
   * @example 'https://dashboard.example.com/api/services'
   */
  url?: string;

  /**
   * Custom registry callbacks for non-HTTP integrations
   */
  handler?: RegistryHandler;

  /**
   * API key for authentication
   */
  apiKey?: string;

  /**
   * Heartbeat interval in milliseconds
   * @default 30000 (30 seconds)
   */
  heartbeatInterval?: number;

  /**
   * Request timeout in milliseconds for registry HTTP calls
   * @default 5000
   */
  requestTimeoutMs?: number;

  /**
   * Number of retry attempts for registry calls
   * @default 2
   */
  retryAttempts?: number;

  /**
   * Base delay in milliseconds for exponential backoff retries
   * @default 300
   */
  retryBaseDelayMs?: number;

  /**
   * Custom metadata to send with registration
   */
  metadata?: Record<string, unknown>;
}

/**
 * Service info sent to dashboard
 */
export interface ServiceInfo {
  /** App name from package.json */
  name: string;
  /** Version from package.json */
  version: string;
  /** Hostname of the server */
  hostname: string;
  /** Operating system platform */
  platform: NodeJS.Platform;
  /** OS architecture */
  arch: string;
  /** Node.js version */
  nodeVersion: string;
  /** Process ID */
  pid: number;
  /** Process uptime in seconds */
  uptime: number;
  /** Memory usage */
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Timestamp */
  timestamp: number;
}

/**
 * Health check result
 */
export interface HealthCheckResult {
  /**
   * Overall status
   */
  status: 'healthy' | 'degraded' | 'unhealthy';

  /**
   * Status of each service
   */
  services: {
    databases: Record<string, boolean>;
    sockets: Record<string, boolean>;
    cron: boolean;
  };

  /**
   * Timestamp of the check
   */
  timestamp: number;
}

/**
 * Logger service configuration
 */
export interface LoggerConfig {
  /**
   * Log level: trace, debug, info, warn, error, fatal
   * @default 'info'
   */
  level?: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

  /**
   * Enable pretty printing in development
   * @default false
   */
  prettyPrint?: boolean;

  /**
   * Enable broadcasting logs to WebSocket
   * When true, logs with { broadcast: true } will be sent to WebSocket
   * When false, no logs are broadcast (even with broadcast flag)
   * @default false
   */
  enableBroadcast?: boolean;

  /**
   * Log file destination
   */
  destination?: string;
}

/**
 * Database configuration
 */
export interface DatabaseConfig {
  /**
   * Unique name for this database connection
   * Required when using katax.database()
   */
  name?: string;

  /**
   * Database type
   */
  type: 'postgresql' | 'mysql' | 'mongodb' | 'redis';

  /**
   * Whether this database connection is required for the app to function
   * - true (default): throws error if connection fails, app crashes
   * - false: logs warning if connection fails, returns null, app continues
   * @default true
   */
  required?: boolean;

  /**
   * Connection string or connection options
   */
  connection:
    | string
    | PostgreSQLConnectionOptions
    | MySQLConnectionOptions
    | MongoDBConnectionOptions
    | RedisConnectionOptions;

  /**
   * Connection pool options
   */
  pool?: PoolConfig;
}

/**
 * PostgreSQL connection options
 */
export interface PostgreSQLConnectionOptions {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | Record<string, unknown>;
}

/**
 * MySQL connection options
 */
export interface MySQLConnectionOptions {
  host: string;
  port?: number;
  database: string;
  user: string;
  password: string;
  ssl?: boolean | Record<string, unknown>;
}

/**
 * MongoDB connection options
 */
export interface MongoDBConnectionOptions {
  host: string;
  port?: number;
  database: string;
  user?: string;
  password?: string;
  authSource?: string;
}

/**
 * Redis connection options
 */
export interface RedisConnectionOptions {
  host: string;
  port?: number;
  password?: string;
  db?: number;
  tls?: boolean;
}

/**
 * Connection pool configuration
 */
export interface PoolConfig {
  /**
   * Maximum number of connections in the pool
   * @default 10
   */
  max?: number;

  /**
   * Minimum number of connections in the pool
   * @default 2
   */
  min?: number;

  /**
   * Maximum time (ms) a connection can be idle before being released
   * @default 30000
   */
  idleTimeoutMillis?: number;

  /**
   * Maximum time (ms) to wait for a connection
   * @default 30000
   */
  connectionTimeoutMillis?: number;
}

/**
 * WebSocket service configuration
 */
export interface WebSocketConfig {
  /**
   * Unique identifier for this WebSocket instance
   * Required when using katax.socket()
   */
  name?: string;

  /**
   * Socket.IO server port (standalone mode)
   * Only used if httpServer is not provided
   * @default 3001
   */
  port?: number;

  /**
   * HTTP server to attach Socket.IO to (shared port mode)
   * When provided, Socket.IO will use the same port as Express
   * @example
   * const httpServer = createServer(app);
   * await katax.socket({ name: 'main', httpServer });
   * httpServer.listen(3000);
   */
  httpServer?: unknown;

  /**
   * CORS configuration
   */
  cors?: {
    origin: string | string[];
    credentials?: boolean;
  };

  /**
   * Authentication token for WebSocket connections
   */
  authToken?: string;

  /**
   * Enable authentication
   * @default false
   */
  enableAuth?: boolean;

  /**
   * Optional custom authentication validator
   * If provided, it will be used when enableAuth is true.
   */
  authValidator?: (token: string | undefined) => boolean | Promise<boolean>;
}

/**
 * Katax lifecycle hooks
 */
export interface KataxLifecycleHooks {
  beforeInit?: () => void | Promise<void>;
  afterInit?: () => void | Promise<void>;
  beforeShutdown?: () => void | Promise<void>;
  afterShutdown?: () => void | Promise<void>;
  onError?: (context: string, error: unknown) => void | Promise<void>;
}

/**
 * Configuration service interface
 */
export interface IConfigService {
  /**
   * Get configuration value by key
   * @param key - Configuration key
   * @param defaultValue - Default value if key not found
   */
  get<T = string>(key: string, defaultValue?: T): T;

  /**
   * Check if a configuration key exists
   * @param key - Configuration key
   */
  has(key: string): boolean;

  /**
   * Set a configuration value
   * @param key - Configuration key
   * @param value - Configuration value
   */
  set<T>(key: string, value: T): void;
}

/**
 * Log message configuration
 */
export interface LogMessage {
  /**
   * The log message
   */
  message: string;

  /**
   * Whether to broadcast this log to WebSocket
   * @default false
   */
  broadcast?: boolean;

  /**
   * Optional room to send the log to (requires broadcast: true)
   */
  room?: string;

  /**
   * Any additional metadata to include in the log
   */
  [key: string]: unknown;
}

/**
 * Transport interface for pluggable log destinations
 */
export interface LogTransport {
  /** Optional name for the transport to identify it */
  name?: string;

  /**
   * Optional filter predicate. If provided, transport will only receive logs
   * when filter(log) returns true.
   */
  filter?(log: LogMessage): boolean;

  /**
   * Send a log message to the transport destination.
   */
  send(log: LogMessage): Promise<void>;

  /** Optional close method for graceful shutdown */
  close?(): Promise<void>;
}

/**
 * Logger service interface
 *
 * Simple and consistent API using objects
 *
 * @example
 * // Local only
 * logger.info({ message: 'Server started' });
 *
 * // Local + broadcast to dashboard
 * logger.info({ message: 'User login', broadcast: true, userId: 123 });
 *
 * // Broadcast to specific room
 * logger.info({ message: 'Production event', broadcast: true, room: 'production' });
 */
export interface ILoggerService {
  trace(log: LogMessage): void;
  debug(log: LogMessage): void;
  info(log: LogMessage): void;
  warn(log: LogMessage): void;
  error(log: LogMessage): void;
  fatal(log: LogMessage): void;

  /**
   * Create a child logger with additional context
   * @param bindings - Key-value pairs to include in all logs
   */
  child(bindings: Record<string, unknown>): ILoggerService;

  /**
   * Set WebSocket service for auto-broadcasting logs
   * Internal use only - called by Katax during initialization
   * @internal
   */
  setSocketService(socketService: IWebSocketService): void;

  /**
   * Register a transport to receive persisted logs
   */
  addTransport(t: LogTransport): void;

  /**
   * Remove a transport by name
   */
  removeTransport(name: string): void;

  /**
   * Close all registered transports gracefully
   */
  closeTransports(): Promise<void>;

  /**
   * Set the application name that will be attached to logs
   */
  setAppName(name: string): void;
}

/**
 * Database service interface
 */
export interface IDatabaseService {
  /**
   * Database configuration (if available)
   */
  config?: DatabaseConfig;

  /**
   * Initialize the database connection pool
   */
  init(): Promise<void>;

  /**
   * Execute a query
   * @param sql - SQL query or operation
   * @param params - Query parameters
   */
  query<T = unknown>(sql: string, params?: unknown[]): Promise<T>;

  /**
   * Get a database client/connection from the pool
   */
  getClient(): Promise<unknown>;

  /**
   * Execute Redis command (only available for Redis connections)
   * @param args - Redis command and arguments
   */
  redis?(...args: readonly unknown[]): Promise<unknown>;

  /**
   * Close all connections and shutdown the pool
   */
  close(): Promise<void>;
}

/**
 * WebSocket service interface
 * Primary use case: Broadcasting logs/events to connected dashboards (unidirectional)
 * Supports rooms for targeted broadcasting (e.g., by project, environment, service)
 */
export interface IWebSocketService {
  /**
   * Initialize the WebSocket server
   */
  init(): Promise<void>;

  /**
   * Emit an event to all connected clients (broadcast)
   * Use this for sending logs, metrics, or any data to dashboards
   * @param event - Event name
   * @param data - Event data
   * @param room - Optional room name to emit only to specific room
   */
  emit(event: string, data: unknown, room?: string): void;

  /**
   * Emit to a specific room only
   * @param room - Room name
   * @param event - Event name
   * @param data - Event data
   */
  emitToRoom(room: string, event: string, data: unknown): void;

  /**
   * Register an event listener for bidirectional communication
   * ⚠️ Use only if you need clients to send commands back to server
   * @param event - Event name
   * @param handler - Event handler function
   */
  on(event: string, handler: (data: unknown) => void): void;

  /**
   * Register a custom connection handler
   * Use this to add custom logic when clients connect
   * @param handler - Connection handler function receiving the socket
   */
  onConnection(handler: (socket: unknown) => void): void;

  /**
   * Check if there are clients connected in a specific room
   * @param room - Room name to check
   * @returns true if room has at least one client
   */
  hasRoomListeners(room: string): boolean;

  /**
   * Get the number of clients connected in a specific room
   * @param room - Room name to check
   * @returns Number of clients in the room
   */
  getRoomClientsCount(room: string): number;

  /**
   * Check if there are any connected clients
   * @returns true if at least one client is connected
   */
  hasConnectedClients(): boolean;

  /**
   * Get total number of connected clients
   * @returns Number of connected clients
   */
  getConnectedClientsCount(): number;

  /**
   * Close the WebSocket server
   */
  close(): Promise<void>;
}

/**
 * Cron job configuration
 */
export interface CronJobConfig {
  /**
   * Unique name for the cron job
   */
  name: string;

  /**
   * Cron expression for scheduling (e.g., '0 * * * *' runs every hour)
   * See https://www.npmjs.com/package/node-cron for full syntax
   */
  schedule: string;

  /**
   * Function to execute when cron fires
   */
  task: () => void | Promise<void>;

  /**
   * Whether this cron job is enabled
   * Can be a boolean value or a function that returns a boolean
   * @default true
   * @example
   * enabled: true
   * enabled: () => process.env.CRON_ENABLED === 'true'
   */
  enabled?: boolean | (() => boolean);

  /**
   * Whether to run the task immediately on initialization
   * Useful for tasks that should run once on startup
   * @default false
   */
  runOnInit?: boolean;

  /**
   * Timezone for the cron job
   * @default 'UTC'
   */
  timezone?: string;
}

/**
 * Cron service configuration
 */
export interface CronConfig {
  /**
   * Array of cron jobs to schedule
   */
  jobs: CronJobConfig[];
}

/**
 * Cron service interface
 */
export interface ICronService {
  /**
   * Initialize the cron service and start enabled jobs
   */
  init(): Promise<void>;

  /**
   * Add a new cron job dynamically
   * @param job - Cron job configuration
   */
  addJob(job: CronJobConfig): void;

  /**
   * Remove a cron job by name
   * @param name - Job name
   */
  removeJob(name: string): void;

  /**
   * Start a specific job
   * @param name - Job name
   */
  startJob(name: string): void;

  /**
   * Stop a specific job
   * @param name - Job name
   */
  stopJob(name: string): void;

  /**
   * Get all registered jobs
   */
  getJobs(): Array<{ name: string; schedule: string; enabled: boolean; running: boolean }>;

  /**
   * Stop all cron jobs
   */
  stopAll(): void;
}
