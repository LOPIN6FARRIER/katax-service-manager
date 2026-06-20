import { describe, it, expect, vi } from 'vitest';
import { LoggerService } from './logger.service.js';
import type { IWebSocketService } from '../types.js';

describe('LoggerService', () => {
  it('broadcasts logs when broadcast is enabled', () => {
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
      close: vi.fn(async () => undefined),
    };

    const logger = new LoggerService({ enableBroadcast: true });
    logger.setSocketService(socket);
    logger.setAppName('katax-service-manager');

    logger.info({ message: 'Bridge connected', broadcast: true, room: 'ops' });

    expect(socket.emit).toHaveBeenCalledWith(
      'log',
      expect.objectContaining({
        level: 'info',
        msg: 'Bridge connected',
        appName: 'katax-service-manager',
      }),
      'ops'
    );
  });

  it('delivers logs to transports with persist:true despite filter', async () => {
    const send = vi.fn(async () => undefined);
    const logger = new LoggerService();

    logger.addTransport({
      name: 'persist-only',
      filter: () => false,
      send,
    });

    logger.error({ message: 'Persist me', persist: true });

    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Persist me',
        level: 'error',
      })
    );
    expect(send.mock.calls[0][0]).not.toHaveProperty('persist');
  });

  it('delivers logs with config param and strips persist from data', async () => {
    const send = vi.fn(async () => undefined);
    const logger = new LoggerService();

    logger.addTransport({ name: 'test', send });

    logger.info({ message: 'Pago procesado', amount: 100 }, { persist: true });

    await Promise.resolve();
    await Promise.resolve();

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Pago procesado',
        amount: 100,
        level: 'info',
      })
    );
    expect(send.mock.calls[0][0]).not.toHaveProperty('persist');
    expect(send.mock.calls[0][0]).not.toHaveProperty('broadcast');
    expect(send.mock.calls[0][0]).not.toHaveProperty('room');
  });
});
