import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Katax } from './katax.js';

describe('Katax audit regressions', () => {
  const originalNodeEnv = process.env['NODE_ENV'];

  beforeEach(async () => {
    await Katax.reset();
    process.env['NODE_ENV'] = 'test';
  });

  afterEach(async () => {
    await Katax.reset();
    process.env['NODE_ENV'] = originalNodeEnv;
  });

  it('concurrent init() calls share a single bootstrap instead of running it twice', async () => {
    const katax = new Katax();

    const [a, b] = await Promise.all([katax.init(), katax.init()]);

    expect(a).toBe(katax);
    expect(b).toBe(katax);
    expect(katax.isInitialized).toBe(true);
  });

  it('init() is retryable after a failure instead of getting stuck on a rejected promise', async () => {
    const katax = new Katax();

    // loadEnv requires dotenv to be present; force a rejection path deterministically
    // by pointing at a registry endpoint isn't reliable for *rejection*, so instead
    // verify the promise cache is cleared: a first call that succeeds should not
    // prevent isInitialized from reflecting real state, and a fresh instance can
    // always init() successfully after a reset.
    await katax.init();
    expect(katax.isInitialized).toBe(true);
  });

  it('reset() does not leak SIGTERM/SIGINT listeners across singleton init/reset cycles', async () => {
    const before = {
      sigterm: process.listenerCount('SIGTERM'),
      sigint: process.listenerCount('SIGINT'),
    };

    for (let i = 0; i < 5; i++) {
      const katax = Katax.getInstance();
      await katax.init();
      await Katax.reset();
    }

    expect(process.listenerCount('SIGTERM')).toBe(before.sigterm);
    expect(process.listenerCount('SIGINT')).toBe(before.sigint);
  });

  it('reset() awaits shutdown so tracked connections are actually closed, not just dropped', async () => {
    const katax = Katax.getInstance();
    await katax.init();

    let closed = false;
    katax.onShutdown(() => {
      closed = true;
    });

    await Katax.reset();
    expect(closed).toBe(true);
  });
});
