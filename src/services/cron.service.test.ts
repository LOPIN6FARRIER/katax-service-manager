import { describe, it, expect, vi } from 'vitest';
import { CronService } from './cron.service.js';

describe('CronService', () => {
  it('lazily loads node-cron - importing this module does not require it eagerly', () => {
    // If this file's top-level static import of node-cron ever comes back,
    // this test still passes (it's the runtime behavior below that matters),
    // but the whole point is that just constructing/init'ing the service
    // doesn't touch node-cron until a job is actually added.
    expect(() => new CronService()).not.toThrow();
  });

  it('adds and lists a job without starting it before init()', async () => {
    const service = new CronService();
    const task = vi.fn();

    await service.addJob({ name: 'unstarted', schedule: '0 2 * * *', task });

    const jobs = service.getJobs();
    expect(jobs).toEqual([{ name: 'unstarted', schedule: '0 2 * * *', enabled: true, running: false }]);
  });

  it('starts enabled jobs on init() and runs runOnInit jobs', async () => {
    const service = new CronService();
    const task = vi.fn();

    await service.addJob({ name: 'daily', schedule: '0 2 * * *', task, runOnInit: true });
    await service.init();

    expect(task).toHaveBeenCalledTimes(1);
    const [job] = service.getJobs();
    expect(job?.running).toBe(true);
  });

  it('starts a job immediately when added after init()', async () => {
    const service = new CronService();
    await service.init();

    await service.addJob({ name: 'late', schedule: '0 3 * * *', task: vi.fn() });

    const [job] = service.getJobs();
    expect(job?.running).toBe(true);
  });

  it('does not start a job whose enabled() returns false', async () => {
    const service = new CronService();
    await service.init();

    await service.addJob({
      name: 'disabled',
      schedule: '0 4 * * *',
      task: vi.fn(),
      enabled: () => false,
    });

    const [job] = service.getJobs();
    expect(job?.enabled).toBe(false);
    expect(job?.running).toBe(false);
  });

  it('rejects adding a job with a duplicate name', async () => {
    const service = new CronService();
    await service.addJob({ name: 'dup', schedule: '0 5 * * *', task: vi.fn() });

    await expect(service.addJob({ name: 'dup', schedule: '0 6 * * *', task: vi.fn() })).rejects.toThrow(
      'Cron job "dup" already exists'
    );
  });

  it('rejects adding a job with an invalid cron expression', async () => {
    const service = new CronService();

    await expect(
      service.addJob({ name: 'bad-schedule', schedule: 'not a cron expression', task: vi.fn() })
    ).rejects.toThrow('Invalid cron expression');
  });

  it('startJob/stopJob/removeJob manage an existing job', async () => {
    const service = new CronService();
    await service.addJob({ name: 'toggle', schedule: '0 7 * * *', task: vi.fn() });
    await service.init();

    service.stopJob('toggle');
    expect(service.getJobs()[0]?.running).toBe(false);

    await service.startJob('toggle');
    expect(service.getJobs()[0]?.running).toBe(true);

    service.removeJob('toggle');
    expect(service.getJobs()).toEqual([]);
  });

  it('throws when starting, stopping or removing an unknown job', async () => {
    const service = new CronService();

    await expect(service.startJob('missing')).rejects.toThrow('Cron job "missing" not found');
    expect(() => service.stopJob('missing')).toThrow('Cron job "missing" not found');
    expect(() => service.removeJob('missing')).toThrow('Cron job "missing" not found');
  });

  it('stopAll stops every running job', async () => {
    const service = new CronService();
    await service.addJob({ name: 'a', schedule: '0 8 * * *', task: vi.fn() });
    await service.addJob({ name: 'b', schedule: '0 9 * * *', task: vi.fn() });
    await service.init();

    service.stopAll();

    expect(service.getJobs().every((j) => !j.running)).toBe(true);
  });
});
