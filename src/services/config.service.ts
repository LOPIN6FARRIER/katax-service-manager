import type { IConfigService } from '../types.js';

/**
 * Configuration service implementation
 * Reads from environment variables, package.json, and in-memory storage
 */
export class ConfigService implements IConfigService {
  private readonly config: Map<string, unknown> = new Map();
  private readonly envPrefix: string = '';

  constructor(envPrefix?: string) {
    if (envPrefix) {
      this.envPrefix = envPrefix;
    }
    this.loadFromEnv();
  }

  /**
   * Load configuration from environment variables
   */
  private loadFromEnv(): void {
    // Load all environment variables
    for (const [key, value] of Object.entries(process.env)) {
      if (this.envPrefix && key.startsWith(this.envPrefix)) {
        const configKey = key.slice(this.envPrefix.length);
        this.config.set(configKey, value);
      } else if (!this.envPrefix) {
        this.config.set(key, value);
      }
    }
  }

  /**
   * Get a configuration value
   */
  public get<T = string>(key: string, defaultValue?: T): T {
    // Check in-memory config first
    if (this.config.has(key)) {
      return this.config.get(key) as T;
    }

    // Check environment variables with prefix
    const envKey = this.envPrefix ? `${this.envPrefix}${key}` : key;
    const envValue = process.env[envKey];
    
    if (envValue !== undefined) {
      return this.parseValue(envValue) as T;
    }

    // Return default value
    if (defaultValue !== undefined) {
      return defaultValue;
    }

    return undefined as T;
  }

  /**
   * Check if a configuration key exists
   */
  public has(key: string): boolean {
    if (this.config.has(key)) {
      return true;
    }

    const envKey = this.envPrefix ? `${this.envPrefix}${key}` : key;
    return process.env[envKey] !== undefined;
  }

  /**
   * Set a configuration value
   */
  public set<T>(key: string, value: T): void {
    this.config.set(key, value);
  }

  /**
   * Parse string value to appropriate type
   */
  private parseValue(value: string): string | number | boolean {
    // Boolean
    if (value === 'true') return true;
    if (value === 'false') return false;

    // Number
    if (!isNaN(Number(value)) && value.trim() !== '') {
      return Number(value);
    }

    // String
    return value;
  }

  /**
   * Get all configuration as object
   */
  public getAll(): Record<string, unknown> {
    return Object.fromEntries(this.config.entries());
  }
}
