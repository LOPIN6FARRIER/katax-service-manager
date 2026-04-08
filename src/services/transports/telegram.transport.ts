import type { LogTransport, LogEntry } from '../../types.js';

export interface TelegramTransportOptions {
  /**
   * Token del bot de Telegram
   */
  botToken: string;

  /**
   * ID del chat (privado o grupo)
   * - Chat privado: número positivo (ej: 123456789)
   * - Grupo: número negativo (ej: -987654321)
   * - Supergrupo: número muy grande negativo (ej: -1001234567890)
   */
  chatId: string | number;

  /**
   * Niveles de log que se enviarán a Telegram
   * Por defecto: ['error', 'fatal']
   */
  levels?: string[];

  /**
   * También enviar logs con flag persist=true
   * Por defecto: true
   */
  includePersist?: boolean;

  /**
   * Formato de mensaje: Markdown o HTML
   * Por defecto: Markdown
   */
  parseMode?: 'Markdown' | 'HTML';

  /**
   * Longitud máxima del mensaje (Telegram tiene límite de 4096 caracteres)
   * Por defecto: 3000
   */
  maxLength?: number;

  /**
   * Nombre del transport (para identificarlo)
   * Por defecto: 'telegram'
   */
  name?: string;
}

/**
 * TelegramTransport - Envía logs a un chat/grupo de Telegram
 *
 * @example
 * ```typescript
 * const telegramTransport = new TelegramTransport({
 *   botToken: process.env.TELEGRAM_BOT_TOKEN!,
 *   chatId: process.env.TELEGRAM_CHAT_ID!,
 *   levels: ['error', 'fatal'],
 *   includePersist: true,
 * });
 *
 * katax.logger.addTransport(telegramTransport);
 * ```
 */
export class TelegramTransport implements LogTransport {
  public name: string;
  private readonly botToken: string;
  private readonly chatId: string;
  private readonly levels: Set<string>;
  private readonly includePersist: boolean;
  private readonly parseMode: 'Markdown' | 'HTML';
  private readonly maxLength: number;

  /**
   * Custom filter function (can be overridden by user)
   * If returns false, the log will NOT be sent to Telegram
   *
   * @example
   * ```typescript
   * telegramTransport.filter = (log) => {
   *   // Don't send if marked with skipTelegram
   *   if (log.skipTelegram) return false;
   *
   *   // Don't send specific error types
   *   if (log.message.includes('not found')) return false;
   *
   *   return true; // Send everything else
   * };
   * ```
   */
  public filter?(log: LogEntry): boolean;

  constructor(options: TelegramTransportOptions) {
    this.botToken = options.botToken;
    this.chatId = String(options.chatId);
    this.levels = new Set(options.levels ?? ['error', 'fatal']);
    this.includePersist = options.includePersist ?? true;
    this.parseMode = options.parseMode ?? 'Markdown';
    this.maxLength = options.maxLength ?? 3000;
    this.name = options.name ?? 'telegram';

    if (!this.botToken) {
      throw new Error('TelegramTransport: botToken is required');
    }
    if (!this.chatId) {
      throw new Error('TelegramTransport: chatId is required');
    }
  }

  /**
   * Filtra logs según nivel y flag persist (default behavior)
   */
  private shouldSend(log: LogEntry): boolean {
    const level = log.level ?? 'info';
    const persist = log.persist === true;

    return this.levels.has(level) || (this.includePersist && persist);
  }

  /**
   * Formatea el log para Telegram
   */
  private formatMessage(log: LogEntry): string {
    const level = (log.level ?? 'info').toUpperCase();
    const appName = log.appName ?? 'app';
    const message =
      typeof log.message === 'string' ? log.message : JSON.stringify(log.message, null, 2);

    const emoji =
      {
        TRACE: '🔍',
        DEBUG: '🐛',
        INFO: 'ℹ️',
        WARN: '⚠️',
        ERROR: '🔥',
        FATAL: '💀',
      }[level] ?? '📝';

    let formatted = `${emoji} *${level}* - \`${appName}\`\n\n${message}`;

    const {
      message: _,
      broadcast,
      room,
      level: __,
      persist,
      appName: ___,
      timestamp,
      skipTransport,
      skipTelegram,
      skipRedis,
      ...metadata
    } = log;

    if (Object.keys(metadata).length > 0) {
      const metaStr = JSON.stringify(metadata, null, 2);
      formatted += `\n\n\`\`\`json\n${metaStr}\n\`\`\``;
    }

    const timestampStr = timestamp
      ? new Date(timestamp).toLocaleString('es-ES', { timeZone: 'America/Mexico_City' })
      : new Date().toLocaleString('es-ES', { timeZone: 'America/Mexico_City' });
    formatted += `\n\n🕐 ${timestampStr}`;

    if (formatted.length > this.maxLength) {
      formatted = formatted.substring(0, this.maxLength - 20) + '\n\n...(truncado)';
    }

    return formatted;
  }

  /**
   * Envía el log a Telegram
   */
  public async send(log: LogEntry): Promise<void> {
    if (!this.shouldSend(log)) {
      return;
    }

    if (this.filter && !this.filter(log)) {
      return;
    }

    try {
      const message = this.formatMessage(log);
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: this.chatId,
          text: message,
          parse_mode: this.parseMode,
          disable_web_page_preview: true,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        console.error(`[TelegramTransport] Error sending message: ${error}`);
      }
    } catch (error: any) {
      console.error(`[TelegramTransport] Failed to send: ${error.message}`);
    }
  }

  /**
   * Cierra el transport (nada que cerrar en este caso)
   */
  public async close(): Promise<void> {}
}
