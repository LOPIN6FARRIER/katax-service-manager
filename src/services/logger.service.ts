import pino, { type Logger as PinoLogger } from 'pino';
import type {
  ILoggerService,
  IWebSocketService,
  LoggerConfig,
  LogConfig,
  LogLevel,
  LogMessage,
  LogTransport,
} from '../types.js';

/**
 * Normalize a LogMessage into an object, extract the message,
 * and split data from control properties.
 */
function splitLog(
  log: LogMessage,
  config?: LogConfig
): {
  message: string;
  mergedConfig: LogConfig;
  data: Record<string, unknown>;
} {
  const obj = typeof log === 'string' ? { message: log } : { ...log };

  const {
    message = '',
    broadcast,
    room,
    persist,
    skipTransport,
    skipTelegram,
    skipRedis,
    ...data
  } = obj;

  const mergedConfig = {
    broadcast: broadcast ?? config?.broadcast,
    room: room ?? config?.room,
    persist: persist ?? config?.persist,
    skipTransport: skipTransport ?? config?.skipTransport,
    skipTelegram: skipTelegram ?? config?.skipTelegram,
    skipRedis: skipRedis ?? config?.skipRedis,
  } as LogConfig;

  return { message, mergedConfig, data };
}

export class LoggerService implements ILoggerService {
  private readonly logger: PinoLogger;
  private readonly broadcastEnabled: boolean;
  private socketService: IWebSocketService | null = null;
  private transports: LogTransport[] = [];
  private appName?: string;

  constructor(
    config?: LoggerConfig,
    existingLogger?: PinoLogger,
    inheritBroadcast?: boolean,
    inheritSocket?: IWebSocketService | null
  ) {
    if (existingLogger !== undefined) {
      this.logger = existingLogger;
      this.broadcastEnabled = inheritBroadcast ?? false;
      this.socketService = inheritSocket ?? null;
      return;
    }

    this.broadcastEnabled = config?.enableBroadcast ?? false;

    const transport = config?.prettyPrint
      ? {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'HH:MM:ss',
            ignore: 'pid,hostname',
            customLevels: 'success:35',
            customColors: 'success:blue',
            useOnlyCustomProps: false,
          },
        }
      : config?.destination
        ? { target: config.destination }
        : undefined;

    this.logger = pino({
      level: config?.level ?? 'info',
      customLevels: { success: 35 },
      ...(transport && { transport }),
      formatters: {
        level: (label) => {
          return { level: label };
        },
      },
    }) as unknown as PinoLogger;
  }

  public setSocketService(socketService: IWebSocketService): void {
    this.socketService = socketService;
  }

  public addTransport(t: LogTransport): void {
    this.transports.push(t);
  }

  public removeTransport(name: string): void {
    this.transports = this.transports.filter((t) => t.name !== name);
  }

  public async closeTransports(): Promise<void> {
    const transports = [...this.transports];
    this.transports = [];

    await Promise.allSettled(
      transports.map(async (transport) => {
        if (transport.close) {
          await transport.close();
        }
      })
    );
  }

  public setAppName(name: string): void {
    this.appName = name;
  }

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
      this.logger.error({ err: error }, 'Failed to broadcast log');
    }
  }

  public trace(log: LogMessage, config?: LogConfig): void {
    const { message, mergedConfig, data } = splitLog(log, config);
    this.logger.trace(data, message);

    if (mergedConfig.broadcast) {
      this.broadcast('trace', message, true, mergedConfig.room, data);
    }

    this.deliverToTransports('trace', { message, ...data }, mergedConfig);
  }

  public debug(log: LogMessage, config?: LogConfig): void {
    const { message, mergedConfig, data } = splitLog(log, config);
    this.logger.debug(data, message);

    if (mergedConfig.broadcast) {
      this.broadcast('debug', message, true, mergedConfig.room, data);
    }

    this.deliverToTransports('debug', { message, ...data }, mergedConfig);
  }

  public info(log: LogMessage, config?: LogConfig): void {
    const { message, mergedConfig, data } = splitLog(log, config);
    this.logger.info(data, message);

    if (mergedConfig.broadcast) {
      this.broadcast('info', message, true, mergedConfig.room, data);
    }

    this.deliverToTransports('info', { message, ...data }, mergedConfig);
  }

  public success(log: LogMessage, config?: LogConfig): void {
    const { message, mergedConfig, data } = splitLog(log, config);
    (this.logger as any).success(data, message);

    if (mergedConfig.broadcast) {
      this.broadcast('success', message, true, mergedConfig.room, data);
    }

    this.deliverToTransports('success', { message, ...data }, mergedConfig);
  }

  public warn(log: LogMessage, config?: LogConfig): void {
    const { message, mergedConfig, data } = splitLog(log, config);
    this.logger.warn(data, message);

    if (mergedConfig.broadcast) {
      this.broadcast('warn', message, true, mergedConfig.room, data);
    }

    this.deliverToTransports('warn', { message, ...data }, mergedConfig);
  }

  public error(log: LogMessage, config?: LogConfig): void {
    const { message, mergedConfig, data } = splitLog(log, config);
    this.logger.error(data, message);

    if (mergedConfig.broadcast) {
      this.broadcast('error', message, true, mergedConfig.room, data);
    }

    this.deliverToTransports('error', { message, ...data }, mergedConfig);
  }

  public fatal(log: LogMessage, config?: LogConfig): void {
    const { message, mergedConfig, data } = splitLog(log, config);
    this.logger.fatal(data, message);

    if (mergedConfig.broadcast) {
      this.broadcast('fatal', message, true, mergedConfig.room, data);
    }

    this.deliverToTransports('fatal', { message, ...data }, mergedConfig);
  }

  /**
   * Deliver a log object to configured transports asynchronously.
   * `data` is guaranteed to be free of control keys.
   * `config` supplies `persist` / `skip*` for routing only.
   */
  private deliverToTransports(
    level: LogLevel,
    data: Record<string, unknown>,
    config: LogConfig = {}
  ): void {
    const enriched = {
      ...data,
      level,
      timestamp: Date.now(),
      ...(this.appName && { appName: this.appName }),
    };

    const { persist } = config;

    for (const t of this.transports) {
      try {
        if (persist === false) continue;

        if (t.filter && !t.filter(enriched as any) && persist !== true) continue;

        void t.send(enriched as any).catch((err) => {
          try {
            this.logger.warn({ err }, `Transport ${t.name ?? '<anon>'} failed to send log`);
          } catch {}
        });
      } catch (error) {
        try {
          this.logger.warn({ err: error }, `Transport ${t.name ?? '<anon>'} threw synchronously`);
        } catch {}
      }
    }
  }

  public child(bindings: Record<string, unknown>): ILoggerService {
    const childPinoLogger = this.logger.child(bindings);
    return new LoggerService(undefined, childPinoLogger, this.broadcastEnabled, this.socketService);
  }

  public getPinoLogger(): PinoLogger {
    return this.logger;
  }
}
