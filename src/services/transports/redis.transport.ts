import type { LogTransport, LogEntry, IDatabaseService } from '../../types.js';

/**
 * Options for RedisTransport
 */
export interface RedisTransportOptions {
  /**
   * Redis Stream key where logs will be stored
   * @default 'katax:logs'
   *
   * Can be a string or a function for dynamic keys
   * @example 'my-app:logs'
   * @example (log) => `logs:${log.appName}:${log.level}`
   */
  streamKey?: string | ((log: LogEntry) => string);

  /**
   * Custom formatter for log fields
   * Return an object with key-value pairs to store in Redis
   * @default Built-in format (level, msg, app, meta, timestamp)
   *
   * @example
   * format: (log) => ({
   *   severity: log.level,
   *   message: log.message,
   *   application: log.appName,
   *   data: JSON.stringify(log)
   * })
   */
  format?: (log: LogEntry) => Record<string, string>;

  /**
   * Maximum stream length (uses MAXLEN ~ for approximate trimming)
   * @default undefined (no trimming)
   * @example 10000
   */
  maxLen?: number;

  /**
   * Transport name for identification
   * @default 'redis'
   */
  name?: string;
}

/**
 * RedisTransport writes logs to a Redis Stream using XADD.
 * Requires a DatabaseService configured for Redis (IDatabaseService.redis available).
 *
 * @example
 * // Basic usage
 * const transport = new RedisTransport(redis, 'my-logs');
 *
 * @example
 * // Custom format and dynamic key
 * const transport = new RedisTransport(redis, {
 *   streamKey: (log) => `logs:${log.appName}:${log.level}`,
 *   format: (log) => ({
 *     severity: log.level,
 *     msg: log.message,
 *     app: log.appName || 'unknown',
 *     data: JSON.stringify(log)
 *   }),
 *   maxLen: 5000
 * });
 */
export class RedisTransport implements LogTransport {
  public name?: string;
  private readonly getStreamKey: (log: LogEntry) => string;
  private readonly formatter?: ((log: LogEntry) => Record<string, string>) | undefined;
  private readonly maxLen?: number | undefined;

  constructor(
    private readonly db: IDatabaseService,
    optionsOrKey?: string | RedisTransportOptions
  ) {
    // Parse options (support both old string API and new options object)
    const options: RedisTransportOptions =
      typeof optionsOrKey === 'string' ? { streamKey: optionsOrKey } : (optionsOrKey ?? {});

    this.name = options.name ?? 'redis';
    this.formatter = options.format;
    this.maxLen = options.maxLen;

    // Setup stream key resolver
    const streamKey = options.streamKey ?? 'katax:logs';
    this.getStreamKey = typeof streamKey === 'function' ? streamKey : () => streamKey;

    // Validation
    if (db.config?.type !== 'redis') {
      throw new Error('RedisTransport requires a Redis IDatabaseService');
    }
    if (!db.redis) {
      throw new Error('RedisTransport: provided database service has no redis() method');
    }
  }

  public filter?(_log: LogEntry): boolean {
    // default: persist everything (filter can be overridden by user)
    return true;
  }

  public async send(log: LogEntry): Promise<void> {
    // Get stream key (can be dynamic based on log)
    const streamKey = this.getStreamKey(log);

    // Use custom formatter or default format
    const formattedFields = this.formatter ? this.formatter(log) : this.defaultFormat(log);

    // Convert object to flat array for XADD
    const fields: string[] = [];
    for (const [key, value] of Object.entries(formattedFields)) {
      fields.push(key, value);
    }

    // Build XADD command with optional MAXLEN
    const xaddArgs: (string | number)[] = [streamKey];

    if (this.maxLen !== undefined) {
      xaddArgs.push('MAXLEN', '~', this.maxLen);
    }

    xaddArgs.push('*', ...fields);

    // XADD <stream> [MAXLEN ~ <count>] * field value [field value ...]
    await this.db.redis!('XADD', ...xaddArgs);
  }

  /**
   * Default format for Redis Stream fields
   * Used when no custom format is provided
   */
  private defaultFormat(log: LogEntry): Record<string, string> {
    const { message, broadcast, room, level, timestamp, appName, ...metadata } = log;

    const fields: Record<string, string> = {
      level: level ?? 'info',
      msg: typeof message === 'string' ? message : JSON.stringify(message),
      meta: JSON.stringify(metadata ?? {}),
      timestamp: String(timestamp ?? Date.now()),
    };

    if (appName) {
      fields['app'] = String(appName);
    }

    return fields;
  }

  public async close(): Promise<void> {
    // nothing to close here; DB connection handled by DatabaseService
  }
}
