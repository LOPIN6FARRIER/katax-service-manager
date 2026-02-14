import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';

/**
 * Registry Service
 * Registers service with a central registry/dashboard via HTTP
 * No external dependencies - uses native fetch()
 */

export interface RegistryConfig {
  /**
   * Base URL of the registry/dashboard API
   * @example 'https://dashboard.example.com/api/services'
   */
  url: string;

  /**
   * API key for authentication
   */
  apiKey?: string;

  /**
   * Heartbeat interval in milliseconds
   * @default 30000 (30 seconds)
   */
  heartbeatInterval?: number;

  /**
   * Custom metadata to send with registration
   */
  metadata?: Record<string, unknown>;
}

export interface ServiceInfo {
  /** App name from package.json */
  name: string;
  /** Version from package.json */
  version: string;
  /** Hostname of the server */
  hostname: string;
  /** Operating system platform */
  platform: NodeJS.Platform;
  /** OS architecture */
  arch: string;
  /** Node.js version */
  nodeVersion: string;
  /** Process ID */
  pid: number;
  /** Process uptime in seconds */
  uptime: number;
  /** Memory usage */
  memory: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
  /** Custom metadata */
  metadata?: Record<string, unknown>;
  /** Timestamp */
  timestamp: number;
}

type Logger = {
  info: (msg: { message: string; [key: string]: unknown }) => void;
  error: (msg: { message: string; [key: string]: unknown }) => void;
  warn: (msg: { message: string; [key: string]: unknown }) => void;
};

export class RegistryService {
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private config: RegistryConfig;
  private serviceInfo: { name: string; version: string };
  private logger: Logger | null = null;
  private registered = false;

  constructor(config: RegistryConfig, logger?: Logger) {
    this.config = {
      heartbeatInterval: 30000,
      ...config,
    };
    this.logger = logger ?? null;
    this.serviceInfo = this.readPackageJson();
  }

  /**
   * Read package.json from the current working directory
   */
  private readPackageJson(): { name: string; version: string } {
    const packagePath = join(process.cwd(), 'package.json');

    if (!existsSync(packagePath)) {
      this.logger?.warn({ message: 'package.json not found, using defaults' });
      return { name: 'unknown', version: '0.0.0' };
    }

    try {
      const content = readFileSync(packagePath, 'utf-8');
      const pkg = JSON.parse(content) as { name?: string; version?: string };
      return {
        name: pkg.name ?? 'unknown',
        version: pkg.version ?? '0.0.0',
      };
    } catch (error) {
      this.logger?.error({ message: 'Failed to read package.json', err: error });
      return { name: 'unknown', version: '0.0.0' };
    }
  }

  /**
   * Get current service info with system metrics
   */
  public getServiceInfo(): ServiceInfo {
    const memUsage = process.memoryUsage();

    const info: ServiceInfo = {
      name: this.serviceInfo.name,
      version: this.serviceInfo.version,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      pid: process.pid,
      uptime: Math.floor(process.uptime()),
      memory: {
        rss: memUsage.rss,
        heapTotal: memUsage.heapTotal,
        heapUsed: memUsage.heapUsed,
      },
      timestamp: Date.now(),
    };

    if (this.config.metadata) {
      info.metadata = this.config.metadata;
    }

    return info;
  }

  /**
   * Build headers for HTTP requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['Authorization'] = `Bearer ${this.config.apiKey}`;
    }

    return headers;
  }

  /**
   * Register this service with the registry
   */
  public async register(): Promise<void> {
    const info = this.getServiceInfo();
    const url = `${this.config.url}/register`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(info),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      this.registered = true;
      this.logger?.info({
        message: `Service registered: ${info.name}@${info.version}`,
        hostname: info.hostname,
        registry: this.config.url,
      });

      // Start heartbeat after successful registration
      this.startHeartbeat();
    } catch (error) {
      this.logger?.error({
        message: 'Failed to register with registry',
        url,
        err: error,
      });
      throw error;
    }
  }

  /**
   * Send heartbeat to registry
   */
  private async sendHeartbeat(): Promise<void> {
    const info = this.getServiceInfo();
    const url = `${this.config.url}/heartbeat`;

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify(info),
      });

      if (!response.ok) {
        this.logger?.warn({
          message: `Heartbeat failed: HTTP ${response.status}`,
          url,
        });
      }
    } catch (error) {
      this.logger?.warn({
        message: 'Heartbeat failed',
        err: error,
      });
    }
  }

  /**
   * Start sending heartbeats
   */
  private startHeartbeat(): void {
    this.stopHeartbeat();

    this.heartbeatTimer = setInterval(() => {
      this.sendHeartbeat();
    }, this.config.heartbeatInterval);

    // Prevent timer from keeping the process alive
    this.heartbeatTimer.unref();
  }

  /**
   * Stop heartbeat timer
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /**
   * Check if registered
   */
  public get isRegistered(): boolean {
    return this.registered;
  }

  /**
   * Unregister from registry and stop heartbeats
   */
  public async unregister(): Promise<void> {
    this.stopHeartbeat();

    if (!this.registered) {
      return;
    }

    const info = this.getServiceInfo();
    const url = `${this.config.url}/unregister`;

    try {
      await fetch(url, {
        method: 'POST',
        headers: this.getHeaders(),
        body: JSON.stringify({
          name: info.name,
          version: info.version,
          hostname: info.hostname,
          pid: info.pid,
          timestamp: Date.now(),
        }),
      });

      this.logger?.info({ message: 'Service unregistered from registry' });
    } catch (error) {
      this.logger?.warn({
        message: 'Failed to unregister (registry may be down)',
        err: error,
      });
    }

    this.registered = false;
  }
}
