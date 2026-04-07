import { describe, it, expect } from 'vitest';
import {
  KataxServiceError,
  KataxConfigError,
  KataxNotInitializedError,
  KataxDatabaseError,
  KataxRedisError,
  KataxWebSocketError,
  KataxRegistryError,
} from './errors.js';

describe('Katax error classes', () => {
  it('creates base KataxServiceError with code and details', () => {
    const err = new KataxServiceError('KATAX_TEST_ERROR', 'Test message', {
      source: 'unit-test',
    });

    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(KataxServiceError);
    expect(err.name).toBe('KataxServiceError');
    expect(err.code).toBe('KATAX_TEST_ERROR');
    expect(err.message).toBe('Test message');
    expect(err.details).toEqual({ source: 'unit-test' });
  });

  it('creates KataxConfigError with stable code', () => {
    const err = new KataxConfigError('Invalid env');
    expect(err.code).toBe('KATAX_CONFIG_ERROR');
    expect(err.message).toBe('Invalid env');
  });

  it('creates KataxNotInitializedError with stable code', () => {
    const err = new KataxNotInitializedError();
    expect(err.code).toBe('KATAX_NOT_INITIALIZED');
    expect(err.message).toContain('Katax not initialized');
  });

  it('creates KataxDatabaseError with stable code', () => {
    const err = new KataxDatabaseError('DB failed', { name: 'main' });
    expect(err.code).toBe('KATAX_DATABASE_ERROR');
    expect(err.details).toEqual({ name: 'main' });
  });

  it('creates KataxRedisError with stable code', () => {
    const err = new KataxRedisError('Redis failed');
    expect(err.code).toBe('KATAX_REDIS_ERROR');
  });

  it('creates KataxWebSocketError with stable code', () => {
    const err = new KataxWebSocketError('WS failed');
    expect(err.code).toBe('KATAX_WEBSOCKET_ERROR');
  });

  it('creates KataxRegistryError with stable code', () => {
    const err = new KataxRegistryError('Registry failed');
    expect(err.code).toBe('KATAX_REGISTRY_ERROR');
  });
});
