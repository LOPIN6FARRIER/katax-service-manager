export class KataxServiceError extends Error {
  public readonly code: string;
  public readonly details: Record<string, unknown> | undefined;

  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.details = details;
  }
}

export class KataxConfigError extends KataxServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('KATAX_CONFIG_ERROR', message, details);
  }
}

export class KataxNotInitializedError extends KataxServiceError {
  constructor() {
    super(
      'KATAX_NOT_INITIALIZED',
      'Katax not initialized. Call katax.init() before using any services.\n' +
        'Example: await katax.init(); // or katax.init().then(() => {...})'
    );
  }
}

export class KataxDatabaseError extends KataxServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('KATAX_DATABASE_ERROR', message, details);
  }
}

export class KataxRedisError extends KataxServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('KATAX_REDIS_ERROR', message, details);
  }
}

export class KataxWebSocketError extends KataxServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('KATAX_WEBSOCKET_ERROR', message, details);
  }
}

export class KataxRegistryError extends KataxServiceError {
  constructor(message: string, details?: Record<string, unknown>) {
    super('KATAX_REGISTRY_ERROR', message, details);
  }
}
