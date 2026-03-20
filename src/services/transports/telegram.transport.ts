import type { LogTransport, LogMessage } from '../../types.js';

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
   *   if ((log as any).skipTelegram) return false;
   *
   *   // Don't send specific error types
   *   const message = String((log as any).message ?? '');
   *   if (message.includes('not found')) return false;
   *
   *   return true; // Send everything else
   * };
   * ```
   */
  public filter?(log: LogMessage): boolean;

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
  private shouldSend(log: LogMessage): boolean {
    const level = String((log as any).level ?? 'info');
    const persist = (log as any).persist === true;

    // Enviar si el nivel está en la lista O si tiene persist=true
    return this.levels.has(level) || (this.includePersist && persist);
  }

  /**
   * Formatea el log para Telegram
   */
  private formatMessage(log: LogMessage): string {
    const level = String((log as any).level ?? 'info').toUpperCase();
    const appName = (log as any).appName ?? 'app';
    const message =
      typeof log.message === 'string' ? log.message : JSON.stringify(log.message, null, 2);

    // Emojis según nivel
    const emoji =
      {
        TRACE: '🔍',
        DEBUG: '🐛',
        INFO: 'ℹ️',
        WARN: '⚠️',
        ERROR: '🔥',
        FATAL: '💀',
      }[level] ?? '📝';

    // Formato básico
    let formatted = `${emoji} *${level}* - \`${appName}\`\n\n${message}`;

    // Agregar metadata si existe (filtrar propiedades internas)
    const {
      message: _,
      broadcast,
      room,
      level: __,
      persist,
      appName: ___,
      timestamp: ____, // ← Filtrar timestamp
      skipTransport, // ← Filtrar flags internos
      skipTelegram,
      skipRedis,
      ...metadata
    } = log as any;

    // Solo mostrar metadata si hay propiedades útiles
    if (Object.keys(metadata).length > 0) {
      const metaStr = JSON.stringify(metadata, null, 2);
      formatted += `\n\n\`\`\`json\n${metaStr}\n\`\`\``;
    }

    // Timestamp (mostrar fecha/hora legible, no el número)
    const logTimestamp = (log as any).timestamp;
    const timestamp = logTimestamp
      ? new Date(logTimestamp).toLocaleString('es-ES', { timeZone: 'America/Mexico_City' })
      : new Date().toLocaleString('es-ES', { timeZone: 'America/Mexico_City' });
    formatted += `\n\n🕐 ${timestamp}`;

    // Truncar si es muy largo
    if (formatted.length > this.maxLength) {
      formatted = formatted.substring(0, this.maxLength - 20) + '\n\n...(truncado)';
    }

    return formatted;
  }

  /**
   * Envía el log a Telegram
   */
  public async send(log: LogMessage): Promise<void> {
    // First check default filter (levels & persist)
    if (!this.shouldSend(log)) {
      return;
    }

    // Then check custom filter if defined
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
  public async close(): Promise<void> {
    // Nothing to close
  }
}
