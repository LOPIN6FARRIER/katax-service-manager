import type { LogTransport, LogEntry } from '../../types.js';

/**
 * CallbackTransport allows passing a simple async function to persist logs.
 */
export class CallbackTransport implements LogTransport {
  public name?: string;

  constructor(
    private readonly fn: (log: LogEntry) => Promise<void>,
    name?: string
  ) {
    this.name = name ?? 'callback';
  }

  public async send(log: LogEntry): Promise<void> {
    await this.fn(log);
  }

  public async close(): Promise<void> {}
}
