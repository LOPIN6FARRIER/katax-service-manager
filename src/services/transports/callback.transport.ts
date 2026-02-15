import type { LogTransport, LogMessage } from '../../types.js';

/**
 * CallbackTransport allows passing a simple async function to persist logs.
 */
export class CallbackTransport implements LogTransport {
  public name?: string;

  constructor(private readonly fn: (log: LogMessage) => Promise<void>, name?: string) {
    this.name = name ?? 'callback';
  }

  public async send(log: LogMessage): Promise<void> {
    await this.fn(log);
  }

  public async close(): Promise<void> {
    // nothing to do for callback
  }
}
