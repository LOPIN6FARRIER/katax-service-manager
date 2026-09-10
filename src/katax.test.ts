import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Katax } from './katax.js';
import type { IDatabaseService, ILoggerService } from './types.js';
import { KataxConfigError, KataxDatabaseError } from './errors.js';

describe('Katax lifecycle hooks', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(async () => {
    await Katax.reset();
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(async () => {
    await Katax.reset();
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('calls beforeInit and afterInit hooks', async () => {
    const beforeInit = vi.fn(async () => undefined);
    const afterInit = vi.fn(async () => undefined);

    const katax = Katax.getInstance();
    await katax.init({
      hooks: {
        beforeInit,
        afterInit,
      },
    });

    expect(beforeInit).toHaveBeenCalledTimes(1);
    expect(afterInit).toHaveBeenCalledTimes(1);
  });

  it('calls beforeShutdown and afterShutdown hooks and closes logger transports', async () => {
    const beforeShutdown = vi.fn(async () => undefined);
    const afterShutdown = vi.fn(async () => undefined);
    const closeTransport = vi.fn(async () => undefined);

    const katax = Katax.getInstance();
    await katax.init({
      hooks: {
        beforeShutdown,
        afterShutdown,
      },
    });

    katax.logger.addTransport({
      name: 'test-transport',
      send: async () => undefined,
      close: closeTransport,
    });

    await katax.shutdown();

    expect(beforeShutdown).toHaveBeenCalledTimes(1);
    expect(afterShutdown).toHaveBeenCalledTimes(1);
    expect(closeTransport).toHaveBeenCalledTimes(1);
  });

  it('calls onError hook when registry registration fails', async () => {
    const onError = vi.fn<(context: string, error: unknown) => Promise<void>>(
      async () => undefined
    );

    const katax = Katax.getInstance();
    await katax.init({
      hooks: {
        onError,
      },
      registry: {
        url: 'http://127.0.0.1:1',
        requestTimeoutMs: 50,
        retryAttempts: 0,
        retryBaseDelayMs: 10,
      },
    });

    expect(onError).toHaveBeenCalled();
    const context = onError.mock.calls[0]?.[0];
    expect(context).toBe('registry.register');
  });

  it('supports custom registry handler callbacks', async () => {
    const register = vi.fn(async () => undefined);
    const unregister = vi.fn(async () => undefined);

    const katax = Katax.getInstance();
    await katax.init({
      registry: {
        handler: {
          register,
          unregister,
        },
      },
    });

    expect(register).toHaveBeenCalledTimes(1);

    await katax.shutdown();
    expect(unregister).toHaveBeenCalledTimes(1);
  });

  it('returns overridden database service by name', async () => {
    const katax = new Katax();
    await katax.init();

    const dbMock: IDatabaseService = {
      config: {
        name: 'main',
        type: 'redis',
        connection: 'redis://localhost:6379',
      },
      init: async () => undefined,
      query: async <T>() => [] as unknown as T,
      getClient: async () => ({}),
      redis: async () => 'PONG',
      close: async () => undefined,
    };

    katax.overrideService('db:main', dbMock);

    expect(katax.db('main')).toBe(dbMock);
    const dbFromFactory = await katax.database({
      name: 'main',
      type: 'redis',
      connection: 'redis://localhost:6379',
    });
    expect(dbFromFactory).toBe(dbMock);
  });

  it('returns overridden logger service', async () => {
    const katax = new Katax();
    await katax.init();

    const loggerMock: ILoggerService = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(() => loggerMock),
      setSocketService: vi.fn(),
      addTransport: vi.fn(),
      removeTransport: vi.fn(),
      closeTransports: vi.fn(async () => undefined),
      setAppName: vi.fn(),
    };

    katax.overrideService('logger', loggerMock);
    katax.logger.info({ message: 'from override' });

    expect(loggerMock.info).toHaveBeenCalledWith({ message: 'from override' });
  });

  it('throws KataxConfigError when envRequired key is missing', async () => {
    const katax = new Katax();
    await katax.init();

    const previous = process.env['MISSING_ENV_TEST'];
    delete process.env['MISSING_ENV_TEST'];

    try {
      expect(() => katax.envRequired('MISSING_ENV_TEST')).toThrow(KataxConfigError);
    } finally {
      if (previous !== undefined) {
        process.env['MISSING_ENV_TEST'] = previous;
      }
    }
  });

  it('throws KataxDatabaseError when db is not found', async () => {
    const katax = new Katax();
    await katax.init();

    expect(() => katax.db('not-found-db')).toThrow(KataxDatabaseError);
  });

  it('does not create a cron service until the first katax.cron() call', async () => {
    const katax = new Katax();
    await katax.init();

    // Advanced getter should refuse before any job has ever been added -
    // proves the CronService (and node-cron) isn't touched at init() time.
    expect(() => katax.cronService).toThrow(KataxConfigError);

    await katax.cron({ name: 'lazy-job', schedule: '0 2 * * *', task: vi.fn() });

    expect(katax.cronService.getJobs()).toEqual([
      { name: 'lazy-job', schedule: '0 2 * * *', enabled: true, running: true },
    ]);
  });

  it('reuses the same cron service singleton across multiple katax.cron() calls', async () => {
    const katax = new Katax();
    await katax.init();

    await katax.cron({ name: 'first', schedule: '0 1 * * *', task: vi.fn() });
    const cronServiceAfterFirst = katax.cronService;

    await katax.cron({ name: 'second', schedule: '0 2 * * *', task: vi.fn() });

    expect(katax.cronService).toBe(cronServiceAfterFirst);
    expect(katax.cronService.getJobs()).toHaveLength(2);
  });

  it('rejects katax.cron() with an invalid cron expression', async () => {
    const katax = new Katax();
    await katax.init();

    await expect(
      katax.cron({ name: 'bad', schedule: 'definitely not cron', task: vi.fn() })
    ).rejects.toThrow('Invalid cron expression');
  });

  it('healthCheck reports cron as healthy when it was never used', async () => {
    const katax = new Katax();
    await katax.init();

    const health = await katax.healthCheck();

    expect(health.services.cron).toBe(true);
    expect(health.status).toBe('healthy');
  });

  it('shutdown() does not throw when cron was never used', async () => {
    const katax = new Katax();
    await katax.init();

    await expect(katax.shutdown()).resolves.not.toThrow();
  });

  it('lazily loads WebSocketService on first katax.socket() call and creates a working socket', async () => {
    const { createServer } = await import('http');
    const katax = new Katax();
    await katax.init();

    const httpServer = createServer();
    const socket = await katax.socket({ name: 'main', httpServer });

    expect(socket.getConnectedClientsCount()).toBe(0);
    expect(katax.ws('main')).toBe(socket);

    await socket.close();
  });
});
