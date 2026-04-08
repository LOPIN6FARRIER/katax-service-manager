import { describe, it, expect, vi } from 'vitest';
import { RedisStreamBridgeService } from './redis-stream-bridge.service.js';
import type {
  ILoggerService,
  IRedisDatabase,
  IWebSocketConnection,
  IWebSocketService,
} from '../types.js';

function createLoggerMock(): ILoggerService {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createLoggerMock()),
    setSocketService: vi.fn(),
    addTransport: vi.fn(),
    removeTransport: vi.fn(),
    closeTransports: vi.fn(async () => undefined),
    setAppName: vi.fn(),
  };
}

describe('RedisStreamBridgeService', () => {
  it('creates the consumer group on start', async () => {
    const redisDb: IRedisDatabase = {
      config: { type: 'redis', connection: 'redis://localhost:6379' },
      init: async () => undefined,
      getClient: async () => ({}),
      redis: vi.fn(async (...args: unknown[]) => {
        if (args[0] === 'XGROUP') return 'OK';
        return null;
      }),
      close: async () => undefined,
    };
    const socket: IWebSocketService = {
      init: async () => undefined,
      emit: vi.fn(),
      emitToRoom: vi.fn(),
      on: vi.fn(),
      onConnection: vi.fn(),
      hasRoomListeners: vi.fn(() => false),
      getRoomClientsCount: vi.fn(() => 0),
      hasConnectedClients: vi.fn(() => false),
      getConnectedClientsCount: vi.fn(() => 0),
      close: async () => undefined,
    };

    const bridge = new RedisStreamBridgeService(redisDb, socket, { appName: 'trade-alerts' });
    bridge.stop();
    await bridge.start();
    bridge.stop();

    expect(redisDb.redis).toHaveBeenCalledWith(
      'XGROUP',
      'CREATE',
      'katax:logs',
      'katax-bridge-trade-alerts',
      '$',
      'MKSTREAM'
    );
    expect(socket.onConnection).toHaveBeenCalledTimes(1);
  });

  it('emits and acknowledges matching logs from the stream', async () => {
    const socket: IWebSocketService = {
      init: async () => undefined,
      emit: vi.fn(),
      emitToRoom: vi.fn(),
      on: vi.fn(),
      onConnection: vi.fn(),
      hasRoomListeners: vi.fn(() => false),
      getRoomClientsCount: vi.fn(() => 0),
      hasConnectedClients: vi.fn(() => false),
      getConnectedClientsCount: vi.fn(() => 0),
      close: async () => undefined,
    };

    let bridge: RedisStreamBridgeService;
    const redis = vi.fn(async (...args: unknown[]) => {
      if (args[0] === 'XREADGROUP') {
        return [['katax:logs', [['1-0', ['app', '"trade-alerts"', 'msg', '"ready"']]]]];
      }

      if (args[0] === 'XACK') {
        bridge.stop();
        return 1;
      }

      return null;
    });

    const redisDb: IRedisDatabase = {
      config: { type: 'redis', connection: 'redis://localhost:6379' },
      init: async () => undefined,
      getClient: async () => ({}),
      redis,
      close: async () => undefined,
    };

    bridge = new RedisStreamBridgeService(redisDb, socket, { appName: 'trade-alerts' });
    (bridge as unknown as { running: boolean }).running = true;

    await (bridge as unknown as { loop: () => Promise<void> }).loop();

    expect(socket.emit).toHaveBeenCalledWith(
      'log',
      expect.objectContaining({ id: '1-0', app: 'trade-alerts', msg: 'ready' })
    );
    expect(socket.emitToRoom).toHaveBeenCalledWith(
      'trade-alerts',
      'log',
      expect.objectContaining({ id: '1-0', app: 'trade-alerts', msg: 'ready' })
    );
    expect(redis).toHaveBeenCalledWith('XACK', 'katax:logs', 'katax-bridge-trade-alerts', '1-0');
  });

  it('serves historical logs on project subscription', async () => {
    let connectionHandler: ((socket: IWebSocketConnection) => void) | undefined;
    const socketService: IWebSocketService = {
      init: async () => undefined,
      emit: vi.fn(),
      emitToRoom: vi.fn(),
      on: vi.fn(),
      onConnection: vi.fn((handler) => {
        connectionHandler = handler;
      }),
      hasRoomListeners: vi.fn(() => false),
      getRoomClientsCount: vi.fn(() => 0),
      hasConnectedClients: vi.fn(() => false),
      getConnectedClientsCount: vi.fn(() => 0),
      close: async () => undefined,
    };
    const redisDb: IRedisDatabase = {
      config: { type: 'redis', connection: 'redis://localhost:6379' },
      init: async () => undefined,
      getClient: async () => ({}),
      redis: vi.fn(async (...args: unknown[]) => {
        if (args[0] === 'XRANGE') {
          return [
            ['1-0', ['app', '"trade-alerts"', 'msg', '"buy"']],
            ['2-0', ['app', '"other-app"', 'msg', '"ignore"']],
          ];
        }
        return null;
      }),
      close: async () => undefined,
    };
    const logger = createLoggerMock();
    const handlers = new Map<string, (data: unknown) => void | Promise<void>>();
    const clientSocket: IWebSocketConnection = {
      emit: vi.fn(),
      on: vi.fn((event: string, handler: (data: unknown) => void | Promise<void>) => {
        handlers.set(event, handler);
      }),
      join: vi.fn(),
      leave: vi.fn(),
    };

    const bridge = new RedisStreamBridgeService(
      redisDb,
      socketService,
      { appName: 'trade-alerts' },
      logger
    );

    (bridge as unknown as { attachSocketHandlers: () => void }).attachSocketHandlers();
    connectionHandler?.(clientSocket);
    await handlers.get('subscribe-project')?.('trade-alerts');

    expect(clientSocket.emit).toHaveBeenCalledWith('project-history', {
      app: 'trade-alerts',
      logs: [expect.objectContaining({ id: '1-0', app: 'trade-alerts', msg: 'buy' })],
    });
    expect(clientSocket.join).toHaveBeenCalledWith('trade-alerts');
  });
});
