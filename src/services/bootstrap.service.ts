import { ConfigService } from './config.service.js';
import { LoggerService } from './logger.service.js';
import { CronService } from './cron.service.js';
import type { IConfigService, ILoggerService, ICronService, KataxInitConfig } from '../types.js';

export interface BootstrapResult {
  config: IConfigService;
  logger: ILoggerService;
  cronService: ICronService;
  resolvedAppName: string;
}

export class BootstrapService {
  public async initialize(
    initConfig?: KataxInitConfig,
    fallbackAppName?: string,
    existingLogger?: ILoggerService
  ): Promise<BootstrapResult> {
    const config = new ConfigService();
    
    // Reuse existing logger if provided, otherwise create new one
    let logger: ILoggerService;
    
    if (existingLogger) {
      logger = existingLogger;
      
      // Warn if user tries to reconfigure an already-used logger
      if (initConfig?.logger) {
        console.warn(
          '[Katax] Logger config ignored - logger was already used before init(). ' +
          'To customize logger config, call init() before using logger.'
        );
      }
    } else {
      logger = new LoggerService(initConfig?.logger);
    }

    const explicitAppName = initConfig?.appName;
    const envAppName = process.env['KATAX_APP_NAME'] ?? process.env['npm_package_name'];
    const resolvedAppName = explicitAppName ?? envAppName ?? fallbackAppName ?? 'unknown';

    logger.setAppName(resolvedAppName);

    const cronService = new CronService();
    await cronService.init();

    return {
      config,
      logger,
      cronService,
      resolvedAppName,
    };
  }
}
