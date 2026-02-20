import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import os from 'os';
import type { RegistryConfig, RegistryUnregisterPayload, ServiceInfo } from '../types.js';

/**
 * Registry Service
 * Registers service with a central registry/dashboard via HTTP
 * No external dependencies - uses native fetch()
 */

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
    if (!config.url && !config.handler) {
      throw new Error('RegistryService requires either config.url or config.handler');
    }

    this.config = {
      heartbeatInterval: 30000,
      requestTimeoutMs: 5000,
      retryAttempts: 2,
      retryBaseDelayMs: 300,
      ...config,
    };
    this.logger = logger ?? null;
    this.serviceInfo = this.readPackageJson();
  }

  private get hasHttpRegistry(): boolean {
    return Boolean(this.config.url);
  }

  private get hasHeartbeatTarget(): boolean {
    return this.hasHttpRegistry || Boolean(this.config.handler?.heartbeat);
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

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  private async fetchWithRetry(url: string, body: unknown): Promise<Response> {
    const attempts = Math.max(0, this.config.retryAttempts ?? 2) + 1;
    const baseDelay = Math.max(0, this.config.retryBaseDelayMs ?? 300);
    const timeoutMs = Math.max(1000, this.config.requestTimeoutMs ?? 5000);

    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(body),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          const jitter = Math.floor(Math.random() * 100);
          const delay = baseDelay * 2 ** (attempt - 1) + jitter;
          await this.sleep(delay);
        }
      } finally {
        clearTimeout(timeout);
      }
    }

    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  private async executeAction(
    action: 'register' | 'heartbeat' | 'unregister',
    body: ServiceInfo | RegistryUnregisterPayload
  ): Promise<void> {
    if (action === 'register' && this.config.handler?.register) {
      await this.config.handler.register(body as ServiceInfo);
      return;
    }

    if (action === 'heartbeat' && this.config.handler?.heartbeat) {
      await this.config.handler.heartbeat(body as ServiceInfo);
      return;
    }

    if (action === 'unregister' && this.config.handler?.unregister) {
      await this.config.handler.unregister(body as RegistryUnregisterPayload);
      return;
    }

    if (!this.config.url) {
      throw new Error(`Registry action '${action}' has no handler and no url configured`);
    }

    await this.fetchWithRetry(`${this.config.url}/${action}`, body);
  }

  /**
   * Register this service with the registry
   */
  public async register(): Promise<void> {
    const info = this.getServiceInfo();

    try {
      await this.executeAction('register', info);

      this.registered = true;
      this.logger?.info({
        message: `Service registered: ${info.name}@${info.version}`,
        hostname: info.hostname,
        registry: this.config.url ?? 'custom-handler',
      });

      // Start heartbeat after successful registration
      if (this.hasHeartbeatTarget) {
        this.startHeartbeat();
      }
    } catch (error) {
      this.logger?.error({
        message: 'Failed to register with registry',
        url: this.config.url,
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

    try {
      await this.executeAction('heartbeat', info);
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

    try {
      await this.executeAction('unregister', {
        name: info.name,
        version: info.version,
        hostname: info.hostname,
        pid: info.pid,
        timestamp: Date.now(),
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
