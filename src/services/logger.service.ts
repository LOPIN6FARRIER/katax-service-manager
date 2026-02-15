import pino, { type Logger as PinoLogger } from 'pino';
import type {
  ILoggerService,
  IWebSocketService,
  LoggerConfig,
  LogMessage,
  LogTransport,
} from '../types.js';

/**
 * Logger service implementation using Pino
 * Supports structured logging with optional WebSocket broadcasting
 *
 * Simple and consistent API using objects
 *
 * @example
 * // Local only
 * logger.info({ message: 'Processing request' });
 *
 * // Local + broadcast to all
 * logger.info({ message: 'User created', broadcast: true, userId: 123 });
 *
 * // Local + broadcast to specific room
 * logger.info({ message: 'Production event', broadcast: true, room: 'production', errorCode: 500 });
 */
export class LoggerService implements ILoggerService {
  private readonly logger: PinoLogger;
  private readonly broadcastEnabled: boolean;
  private socketService: IWebSocketService | null = null;
  private transports: LogTransport[] = [];
  private appName?: string;

  /**
   * Create a LoggerService instance
   * @param config - Logger configuration (optional)
   * @param existingLogger - Internal: existing Pino logger for child creation
   * @param inheritBroadcast - Internal: inherit broadcast setting from parent
   * @param inheritSocket - Internal: inherit socket service from parent
   */
  constructor(
    config?: LoggerConfig,
    existingLogger?: PinoLogger,
    inheritBroadcast?: boolean,
    inheritSocket?: IWebSocketService | null
  ) {
    // Child logger creation path
    if (existingLogger !== undefined) {
      this.logger = existingLogger;
      this.broadcastEnabled = inheritBroadcast ?? false;
      this.socketService = inheritSocket ?? null;
      return;
    }

    // Normal initialization path
    this.broadcastEnabled = config?.enableBroadcast ?? false;

    const transport = config?.prettyPrint
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
          },
        }
      : config?.destination
        ? { target: config.destination }
        : undefined;

    this.logger = pino({
      level: config?.level ?? 'info',
      ...(transport && { transport }),
      formatters: {
        level: (label) => {
          return { level: label };
        },
      },
    });
  }

  /**
   * Set the WebSocket service for broadcasting logs
   * Called internally by Katax during initialization
   */
  public setSocketService(socketService: IWebSocketService): void {
    this.socketService = socketService;
  }

  public addTransport(t: LogTransport): void {
    this.transports.push(t);
  }

  public removeTransport(name: string): void {
    this.transports = this.transports.filter((t) => t.name !== name);
  }

  public setAppName(name: string): void {
    this.appName = name;
  }

  /**
   * Broadcast log to WebSocket if enabled
   * @param level - Log level
   * @param message - Log message
   * @param shouldBroadcast - Whether to broadcast this log
   * @param room - Optional room to send to
   * @param metadata - Optional additional metadata
   */
  private broadcast(
    level: string,
    message: string,
    shouldBroadcast: boolean,
    room?: string,
    metadata?: Record<string, unknown>
  ): void {
    if (!this.broadcastEnabled || !this.socketService || !shouldBroadcast) {
      return;
    }

    try {
      const dataToSend = {
        level,
        msg: message,
        ...(metadata && metadata),
        appName: this.appName,
        timestamp: Date.now(),
      };

      this.socketService.emit('log', dataToSend, room);
    } catch (error) {
      // Log broadcast failure locally (don't broadcast to avoid infinite loop)
      this.logger.error({ err: error }, 'Failed to broadcast log');
    }
  }

  public trace(log: LogMessage): void {
    const { message, broadcast, room, ...metadata } = log;

    // Log locally with metadata
    this.logger.trace(metadata, message);

    // Broadcast if requested
    if (broadcast) {
      this.broadcast('trace', message, true, room, metadata);
    }

    // deliver to transports asynchronously
    this.deliverToTransports('trace', { message, ...metadata });
  }

  public debug(log: LogMessage): void {
    const { message, broadcast, room, ...metadata } = log;

    this.logger.debug(metadata, message);

    if (broadcast) {
      this.broadcast('debug', message, true, room, metadata);
    }

    this.deliverToTransports('debug', { message, ...metadata });
  }

  public info(log: LogMessage): void {
    const { message, broadcast, room, ...metadata } = log;

    this.logger.info(metadata, message);

    if (broadcast) {
      this.broadcast('info', message, true, room, metadata);
    }

    this.deliverToTransports('info', { message, ...metadata });
  }

  public warn(log: LogMessage): void {
    const { message, broadcast, room, ...metadata } = log;

    this.logger.warn(metadata, message);

    if (broadcast) {
      this.broadcast('warn', message, true, room, metadata);
    }

    this.deliverToTransports('warn', { message, ...metadata });
  }

  public error(log: LogMessage): void {
    const { message, broadcast, room, ...metadata } = log;

    this.logger.error(metadata, message);

    if (broadcast) {
      this.broadcast('error', message, true, room, metadata);
    }

    this.deliverToTransports('error', { message, ...metadata });
  }

  public fatal(log: LogMessage): void {
    const { message, broadcast, room, ...metadata } = log;

    this.logger.fatal(metadata, message);

    if (broadcast) {
      this.broadcast('fatal', message, true, room, metadata);
    }

    this.deliverToTransports('fatal', { message, ...metadata });
  }

  /**
   * Deliver a log object to configured transports asynchronously.
   * Respects transport.filter and per-log override `persist` when present.
   */
  private deliverToTransports(level: string, log: LogMessage): void {
    // Attach level, timestamp and appName
    const enriched: LogMessage = {
      ...log,
      level,
      timestamp: Date.now(),
      appName: this.appName,
    };

    const persistOverride = Object.prototype.hasOwnProperty.call(enriched, 'persist')
      ? (enriched as any).persist
      : undefined;

    for (const t of this.transports) {
      try {
        // Determine if transport wants this log
        if (persistOverride === false) {
          continue;
        }

        if (t.filter && !t.filter(enriched) && persistOverride !== true) {
          continue;
        }

        // fire-and-forget; log transport errors locally
        void t.send(enriched).catch((err) => {
          try {
            this.logger.warn({ err }, `Transport ${t.name ?? '<anon>'} failed to send log`);
          } catch (_) {
            // swallow
          }
        });
      } catch (error) {
        try {
          this.logger.warn({ err: error }, `Transport ${t.name ?? '<anon>'} threw synchronously`);
        } catch (_) {
          // swallow
        }
      }
    }
  }

  public child(bindings: Record<string, unknown>): ILoggerService {
    const childPinoLogger = this.logger.child(bindings);
    return new LoggerService(undefined, childPinoLogger, this.broadcastEnabled, this.socketService);
  }

  /**
   * Get the underlying Pino logger instance
   * Useful for advanced use cases
   */
  public getPinoLogger(): PinoLogger {
    return this.logger;
  }
}
