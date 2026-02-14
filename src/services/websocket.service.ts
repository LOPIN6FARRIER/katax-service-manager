import { Server as SocketIOServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import pino from 'pino';
import type { IWebSocketService, WebSocketConfig } from '../types.js';

// Internal logger for WebSocket service
const logger = pino({ name: 'katax:websocket' });

/**
 * WebSocket service implementation using Socket.IO
 * Provides real-time communication capabilities
 */
export class WebSocketService implements IWebSocketService {
  private io: SocketIOServer | null = null;
  private readonly config: WebSocketConfig;
  private initialized = false;

  constructor(config?: WebSocketConfig) {
    this.config = config ?? {};
  }

  /**
   * Initialize the WebSocket server
   * Supports two modes:
   * - Standalone: Creates its own server on specified port
   * - Attached: Attaches to existing HTTP server (shares port with Express)
   */
  public async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const corsConfig = this.config.cors ?? {
        origin: '*',
        credentials: false,
      };

      // Mode 1: Attached to existing HTTP server (same port as Express)
      if (this.config.httpServer) {
        logger.info('Attaching Socket.IO to existing HTTP server');
        this.io = new SocketIOServer(this.config.httpServer as HttpServer, {
          cors: corsConfig,
        });
      }
      // Mode 2: Standalone server (separate port)
      else {
        const port = this.config.port ?? 3001;
        logger.info({ port }, 'Creating standalone Socket.IO server');
        this.io = new SocketIOServer(port, {
          cors: corsConfig,
        });
      }

      // Handle authentication if enabled
      if (this.config.enableAuth && this.config.authToken) {
        this.io.use((socket, next) => {
          const token = socket.handshake.auth['token'] as string | undefined;
          if (token === this.config.authToken) {
            next();
          } else {
            next(new Error('Authentication failed'));
          }
        });
      }

      // Handle connections
      this.io.on('connection', (socket) => {
        logger.info({ socketId: socket.id }, 'WebSocket client connected');

        // Handle room joining
        socket.on('join-room', (room: string) => {
          socket.join(room);
          logger.info({ socketId: socket.id, room }, 'Client joined room');
          socket.emit('room-joined', { room });
        });

        // Handle room leaving
        socket.on('leave-room', (room: string) => {
          socket.leave(room);
          logger.info({ socketId: socket.id, room }, 'Client left room');
          socket.emit('room-left', { room });
        });

        socket.on('disconnect', () => {
          logger.info({ socketId: socket.id }, 'WebSocket client disconnected');
        });
      });

      this.initialized = true;
    } catch (error) {
      throw new Error(
        `Failed to initialize WebSocket: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Emit an event to all connected clients or to a specific room
   *
   * Note: For logs, use katax.logger with enableBroadcast=true instead.
   * The logger will automatically emit to WebSocket.
   *
   * Use this method for custom events like metrics, notifications, etc.
   *
   * @example
   * // Broadcast to all
   * katax.socket.emit('metric', { cpu: 45, memory: 1024 });
   *
   * // Only to specific room
   * katax.socket.emit('notification', { msg: 'Deploy done' }, 'production');
   */
  public emit(event: string, data: unknown, room?: string): void {
    if (!this.initialized || !this.io) {
      throw new Error('WebSocket not initialized. Call init() first.');
    }

    if (room) {
      this.io.to(room).emit(event, data);
    } else {
      this.io.emit(event, data);
    }
  }

  /**
   * Emit to a specific room only
   * Convenience method for room-specific emissions
   *
   * @example
   * katax.socket.emitToRoom('api-prod', 'log', { level: 'info', msg: 'Request processed' });
   * katax.socket.emitToRoom('api-dev', 'log', { level: 'debug', msg: 'Debug info' });
   */
  public emitToRoom(room: string, event: string, data: unknown): void {
    this.emit(event, data, room);
  }

  /**
   * Register an event listener on the Socket.IO server
   * ⚠️ Use with caution - only for bidirectional communication
   * For log monitoring, you typically only need emit()
   *
   * @example
   * // Server listens to client commands (bidirectional)
   * katax.socket.on('restart-worker', (data) => {
   *   console.log('Received restart command:', data);
   * });
   */
  public on(event: string, handler: (data: unknown) => void): void {
    if (!this.initialized || !this.io) {
      throw new Error('WebSocket not initialized. Call init() first.');
    }

    this.io.on(event, handler);
  }

  /**
   * Close the WebSocket server
   */
  public async close(): Promise<void> {
    if (!this.initialized || !this.io) {
      return;
    }

    return new Promise((resolve) => {
      if (this.io) {
        this.io.close(() => {
          this.initialized = false;
          this.io = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  /**
   * Get the underlying Socket.IO server instance
   * Useful for advanced use cases
   */
  public getServer(): SocketIOServer | null {
    return this.io;
  }
}
