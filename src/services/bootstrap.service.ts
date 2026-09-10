import { ConfigService } from './config.service.js';
import { LoggerService } from './logger.service.js';
import type { IConfigService, ILoggerService, KataxInitConfig } from '../types.js';

export interface BootstrapResult {
  config: IConfigService;
  logger: ILoggerService;
  resolvedAppName: string;
}

export class BootstrapService {
  /**
   * Creates the core services used by Katax during bootstrap.
   */
  public async initialize(
    initConfig?: KataxInitConfig,
    fallbackAppName?: string,
    existingLogger?: ILoggerService
  ): Promise<BootstrapResult> {
    const config = new ConfigService();
    let logger: ILoggerService;

    if (existingLogger) {
      logger = existingLogger;

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

    return {
      config,
      logger,
      resolvedAppName,
    };
  }
}
