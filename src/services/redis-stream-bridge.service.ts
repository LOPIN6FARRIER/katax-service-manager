import type { IDatabaseService, IWebSocketService } from '../types.js';

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
    private readonly redis: IDatabaseService,
    private readonly socket: IWebSocketService,
    config: RedisStreamBridgeConfig
  ) {
    if (redis.config?.type !== 'redis') {
      throw new Error('RedisStreamBridgeService requires a Redis database connection');
    }
    if (!redis.redis) {
      throw new Error('Redis connection does not support redis() method');
    }

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
      await this.redis.redis!('XGROUP', 'CREATE', this.streamKey, this.group, '$', 'MKSTREAM');
    } catch (err: any) {
      // BUSYGROUP means the group already exists - this is OK
      if (!String(err).includes('BUSYGROUP')) {
        console.warn('[RedisStreamBridge] Failed to create consumer group:', err);
      }
    }
  }

  /**
   * Parse Redis stream entry into JSON object
   */
  private parseEntry(entry: [string, string[]]): any {
    const id = entry[0];
    const fields: string[] = entry[1];
    const obj: any = { id };

    for (let i = 0; i < fields.length; i += 2) {
      const key = fields[i];
      const value = fields[i + 1];

      if (!key) continue; // Skip if key is undefined

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
        const result = await this.redis.redis!(
          'XREADGROUP',
          'GROUP',
          this.group,
          this.consumer,
          'BLOCK',
          String(this.blockTimeout), // ← Convert to string for Redis
          'COUNT',
          String(this.batchSize), // ← Convert to string for Redis
          'STREAMS',
          this.streamKey,
          '>'
        );

        if (!result) continue;

        // result format: [[streamKey, [[id, [field, value, ...]], ...]]]
        for (const [, entries] of result as [string, [string, string[]][]][]) {
          for (const entry of entries) {
            const log = this.parseEntry(entry);

            // Only process logs from this app
            if (log.app !== this.appName) {
              // ACK and skip logs from other apps
              try {
                await this.redis.redis!('XACK', this.streamKey, this.group, log.id);
              } catch (err) {
                // Ignore ACK errors
              }
              continue;
            }

            try {
              // Emit to all connected clients
              this.socket.emit('log', log);

              // Also emit to the app-specific room
              this.socket.emitToRoom(this.appName, 'log', log);
            } catch (err) {
              console.warn('[RedisStreamBridge] Failed to emit log via WebSocket:', err);
            }

            // Acknowledge message
            try {
              await this.redis.redis!('XACK', this.streamKey, this.group, log.id);
            } catch (err) {
              // Ignore ACK errors
            }
          }
        }
      } catch (err) {
        console.warn('[RedisStreamBridge] Error reading Redis stream:', err);
        await this.sleep(500);
      }
    }
  }

  /**
   * Attach WebSocket handlers for subscriptions
   */
  private attachSocketHandlers(): void {
    this.socket.onConnection((socket: any) => {
      // Handle project subscription
      socket.on('subscribe-project', async (appName: string) => {
        try {
          // Fetch recent logs for this project (last 100)
          const range = await this.redis.redis!('XRANGE', this.streamKey, '-', '+', 'COUNT', '100');

          if (!range) return;

          const recent: any[] = [];
          for (const entry of range as [string, string[]][]) {
            const log = this.parseEntry(entry);
            if (log.app === appName) {
              recent.push(log);
            }
          }

          // Send historical logs
          socket.emit('project-history', { app: appName, logs: recent });

          // Join room for real-time updates
          socket.join(appName);
        } catch (err) {
          console.warn('[RedisStreamBridge] subscribe-project handler failed:', err);
        }
      });

      // Handle unsubscribe
      socket.on('unsubscribe-project', (appName: string) => {
        try {
          socket.leave(appName);
        } catch (err) {
          console.warn('[RedisStreamBridge] unsubscribe-project handler failed:', err);
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

    // Start the loop (don't await, it runs in background)
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
