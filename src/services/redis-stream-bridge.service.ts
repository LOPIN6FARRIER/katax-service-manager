import type {
  ILoggerService,
  IRedisDatabase,
  IWebSocketConnection,
  IWebSocketService,
} from '../types.js';

type RedisStreamEntry = [id: string, fields: string[]];
type RedisStreamResponse = Array<[streamKey: string, entries: RedisStreamEntry[]]>;

interface BridgeLogEntry {
  id: string;
  app?: string;
  [key: string]: unknown;
}

/**
 * Configuration for Redis Stream Bridge
 */
export interface RedisStreamBridgeConfig {
  /**
   * Application name to filter logs for.
   * Used as consumer group name to ensure each app gets all its logs.
   * @example 'trade-alerts', 'market-data', 'user-service'
   */
  appName: string;

  /**
   * Redis stream key to read from
   * @default 'katax:logs'
   */
  streamKey?: string;

  /**
   * Consumer group name override.
   * By default uses `katax-bridge-${appName}`
   */
  group?: string;

  /**
   * Number of messages to read per batch
   * @default 10
   */
  batchSize?: number;

  /**
   * Block timeout in milliseconds for XREADGROUP
   * @default 2000
   */
  blockTimeout?: number;
}

/**
 * Redis Stream Bridge Service
 *
 * Reads logs from a Redis Stream and broadcasts them via WebSocket.
 * Supports:
 * - Real-time log streaming to dashboard
 * - Project-specific subscriptions (rooms)
 * - Historical log retrieval
 *
 * @example
 * const bridge = new RedisStreamBridgeService(redisDb, socket, {
 *   appName: 'trade-alerts',
 *   streamKey: 'katax:logs'
 * });
 * await bridge.start();
 */
export class RedisStreamBridgeService {
  private running = false;
  private readonly appName: string;
  private readonly streamKey: string;
  private readonly group: string;
  private readonly batchSize: number;
  private readonly blockTimeout: number;
  private readonly consumer: string;

  constructor(
    private readonly redis: IRedisDatabase,
    private readonly socket: IWebSocketService,
    config: RedisStreamBridgeConfig,
    private readonly logger?: ILoggerService
  ) {
    this.appName = config.appName;
    this.streamKey = config.streamKey ?? 'katax:logs';
    this.group = config.group ?? `katax-bridge-${config.appName}`;
    this.batchSize = config.batchSize ?? 10;
    this.blockTimeout = config.blockTimeout ?? 2000;
    this.consumer = `bridge-${process.pid}-${Date.now()}`;
  }

  /**
   * Ensure the consumer group exists
   */
  private async ensureGroup(): Promise<void> {
    try {
      await this.redis.redis('XGROUP', 'CREATE', this.streamKey, this.group, '$', 'MKSTREAM');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes('BUSYGROUP')) {
        this.logger?.warn({
          message: 'RedisStreamBridge failed to create consumer group',
          err,
          streamKey: this.streamKey,
          group: this.group,
        });
      }
    }
  }

  /**
   * Parse Redis stream entry into JSON object
   */
  private parseEntry(entry: RedisStreamEntry): BridgeLogEntry {
    const id = entry[0];
    const fields: string[] = entry[1];
    const obj: BridgeLogEntry = { id };

    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const value = fields[i + 1];

      if (!key) continue;

      try {
        obj[key] = value ? JSON.parse(value) : value;
      } catch {
        obj[key] = value;
      }
    }

    return obj;
  }

  /**
   * Main loop - reads from Redis Stream and emits via WebSocket
   */
  private async loop(): Promise<void> {
    while (this.running) {
      try {
        const result = (await this.redis.redis(
          'XREADGROUP',
          'GROUP',
          this.group,
          this.consumer,
          'BLOCK',
          String(this.blockTimeout),
          'COUNT',
          String(this.batchSize),
          'STREAMS',
          this.streamKey,
          '>'
        )) as RedisStreamResponse | null;

        if (!result) continue;

        for (const [, entries] of result) {
          for (const entry of entries) {
            const log = this.parseEntry(entry);

            if (log.app !== this.appName) {
              try {
                await this.redis.redis('XACK', this.streamKey, this.group, log.id);
              } catch {}
              continue;
            }

            try {
              this.socket.emit('log', log);
              this.socket.emitToRoom(this.appName, 'log', log);
            } catch (err: unknown) {
              this.logger?.warn({
                message: 'RedisStreamBridge failed to emit log via WebSocket',
                err,
                appName: this.appName,
              });
            }

            try {
              await this.redis.redis('XACK', this.streamKey, this.group, log.id);
            } catch {}
          }
        }
      } catch (err: unknown) {
        this.logger?.warn({
          message: 'RedisStreamBridge error reading Redis stream',
          err,
          streamKey: this.streamKey,
          group: this.group,
        });
        await this.sleep(500);
      }
    }
  }

  /**
   * Attach WebSocket handlers for subscriptions
   */
  private attachSocketHandlers(): void {
    this.socket.onConnection((socket: IWebSocketConnection) => {
      socket.on('subscribe-project', async (data: unknown) => {
        if (typeof data !== 'string' || data.length === 0) {
          return;
        }

        const appName = data;

        try {
          const range = (await this.redis.redis(
            'XRANGE',
            this.streamKey,
            '-',
            '+',
            'COUNT',
            '100'
          )) as RedisStreamEntry[] | null;

          if (!range) return;

          const recent: BridgeLogEntry[] = [];
          for (const entry of range) {
            const log = this.parseEntry(entry);
            if (log.app === appName) {
              recent.push(log);
            }
          }

          socket.emit('project-history', { app: appName, logs: recent });
          socket.join(appName);
        } catch (err: unknown) {
          this.logger?.warn({
            message: 'RedisStreamBridge subscribe-project handler failed',
            err,
            appName,
          });
        }
      });

      socket.on('unsubscribe-project', (data: unknown) => {
        if (typeof data !== 'string' || data.length === 0) {
          return;
        }

        const appName = data;

        try {
          socket.leave(appName);
        } catch (err: unknown) {
          this.logger?.warn({
            message: 'RedisStreamBridge unsubscribe-project handler failed',
            err,
            appName,
          });
        }
      });
    });
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Start the bridge
   */
  public async start(): Promise<void> {
    if (this.running) {
      return;
    }

    this.running = true;
    await this.ensureGroup();
    this.attachSocketHandlers();
    void this.loop();
  }

  /**
   * Stop the bridge
   */
  public stop(): void {
    this.running = false;
  }

  /**
   * Check if bridge is running
   */
  public isRunning(): boolean {
    return this.running;
  }
}
