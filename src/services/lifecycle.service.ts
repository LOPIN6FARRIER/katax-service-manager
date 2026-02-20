import type {
  ICronService,
  IDatabaseService,
  ILoggerService,
  IWebSocketService,
  KataxLifecycleHooks,
} from '../types.js';
import { RegistryService } from './registry.service.js';

export class LifecycleService {
  public async shutdown(params: {
    logger: ILoggerService;
    databases: Map<string, IDatabaseService>;
    sockets: Map<string, IWebSocketService>;
    cronService: ICronService;
    registry: RegistryService | null;
    hooks?: KataxLifecycleHooks | null;
  }): Promise<{ registry: RegistryService | null }> {
    const { logger, databases, sockets, cronService, hooks } = params;
    let { registry } = params;

    await hooks?.beforeShutdown?.();

    logger.info({ message: 'Shutting down Katax services...' });
    const errors: Array<{ service: string; error: unknown }> = [];

    if (databases.size > 0) {
      logger.info({ message: `Closing ${databases.size} database connection(s)...` });
      const dbCloseResults = await Promise.allSettled(
        Array.from(databases.entries()).map(async ([name, db]) => {
          await db.close();
          return name;
        })
      );

      for (const result of dbCloseResults) {
        if (result.status === 'fulfilled') {
          logger.info({ message: `Database '${result.value}' closed` });
        } else {
          logger.error({ message: 'Failed to close database', err: result.reason });
          errors.push({ service: 'database', error: result.reason });
          await hooks?.onError?.('database.close', result.reason);
        }
      }
      databases.clear();
    }

    if (sockets.size > 0) {
      logger.info({ message: `Closing ${sockets.size} WebSocket server(s)...` });
      const socketCloseResults = await Promise.allSettled(
        Array.from(sockets.entries()).map(async ([name, socket]) => {
          await socket.close();
          return name;
        })
      );

      for (const result of socketCloseResults) {
        if (result.status === 'fulfilled') {
          logger.info({ message: `WebSocket '${result.value}' closed` });
        } else {
          logger.error({ message: 'Failed to close WebSocket', err: result.reason });
          errors.push({ service: 'websocket', error: result.reason });
          await hooks?.onError?.('websocket.close', result.reason);
        }
      }
      sockets.clear();
    }

    try {
      cronService.stopAll();
      logger.info({ message: 'Cron jobs stopped' });
    } catch (error) {
      logger.error({ message: 'Failed to stop cron jobs', err: error });
      errors.push({ service: 'cron', error });
      await hooks?.onError?.('cron.stopAll', error);
    }

    if (registry) {
      try {
        await registry.unregister();
        logger.info({ message: 'Unregistered from registry' });
      } catch (error) {
        logger.error({ message: 'Failed to unregister from registry', err: error });
        errors.push({ service: 'registry', error });
        await hooks?.onError?.('registry.unregister', error);
      }
      registry = null;
    }

    try {
      await logger.closeTransports();
    } catch (error) {
      errors.push({ service: 'logger-transports', error });
      await hooks?.onError?.('logger.closeTransports', error);
    }

    if (errors.length > 0) {
      logger.warn({ message: `Shutdown completed with ${errors.length} error(s)` });
    } else {
      logger.info({ message: '✓ Katax services shutdown complete' });
    }

    await hooks?.afterShutdown?.();

    return { registry };
  }
}
