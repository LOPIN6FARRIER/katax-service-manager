import type {
  HealthCheckResult,
  ICronService,
  IDatabaseService,
  IWebSocketService,
} from '../types.js';

export class HealthService {
  public async check(
    databases: Map<string, IDatabaseService>,
    sockets: Map<string, IWebSocketService>,
    cronService: ICronService
  ): Promise<HealthCheckResult> {
    const result: HealthCheckResult = {
      status: 'healthy',
      services: {
        databases: {},
        sockets: {},
        cron: true,
      },
      timestamp: Date.now(),
    };

    for (const [name, db] of databases) {
      try {
        if (db.config?.type === 'redis') {
          await db.redis?.('PING');
        } else if (db.config?.type === 'mongodb') {
          const client = await db.getClient();
          await (client as { db: () => { command: (cmd: object) => Promise<unknown> } })
            .db()
            .command({ ping: 1 });
        } else {
          await db.query('SELECT 1');
        }
        result.services.databases[name] = true;
      } catch {
        result.services.databases[name] = false;
        result.status = 'degraded';
      }
    }

    for (const [name, socket] of sockets) {
      try {
        const server = (socket as { getServer?: () => unknown }).getServer?.();
        result.services.sockets[name] = server !== null;
      } catch {
        result.services.sockets[name] = false;
        result.status = 'degraded';
      }
    }

    try {
      cronService.getJobs();
      result.services.cron = true;
    } catch {
      result.services.cron = false;
      result.status = 'degraded';
    }

    const allDbsHealthy = Object.values(result.services.databases).every((v) => v);
    const allSocketsHealthy = Object.values(result.services.sockets).every((v) => v);

    if (!allDbsHealthy || !allSocketsHealthy || !result.services.cron) {
      result.status = 'degraded';
    }

    if (databases.size > 0 && !Object.values(result.services.databases).some((v) => v)) {
      result.status = 'unhealthy';
    }

    return result;
  }
}
