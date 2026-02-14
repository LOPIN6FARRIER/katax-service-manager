import cron, { type ScheduledTask } from 'node-cron';
import pino from 'pino';
import type { ICronService, CronJobConfig } from '../types.js';

// Internal logger for Cron service
const logger = pino({ name: 'katax:cron' });

/**
 * Job state information
 */
interface JobState {
  config: CronJobConfig;
  task: ScheduledTask | null;
  running: boolean;
}

/**
 * Cron service implementation using node-cron
 * Manages scheduled tasks with enable/disable logic and run-on-init support
 *
 * @example
 * // Basic usage
 * await katax.init({
 *   cron: {
 *     jobs: [
 *       {
 *         name: 'cleanup',
 *         schedule: '0 2 * * *', // Daily at 2 AM
 *         task: async () => {
 *           console.log('Running cleanup...');
 *         }
 *       }
 *     ]
 *   }
 * });
 *
 * @example
 * // With conditional enable and run on init
 * await katax.init({
 *   cron: {
 *     jobs: [
 *       {
 *         name: 'backup',
 *         schedule: '0 * * * *', // Every hour
 *         enabled: () => process.env.BACKUP_ENABLED === 'true',
 *         runOnInit: true,
 *         task: async () => {
 *           console.log('Running backup...');
 *         }
 *       }
 *     ]
 *   }
 * });
 */
export class CronService implements ICronService {
  private jobs: Map<string, JobState> = new Map();
  private initialized = false;

  /**
   * Initialize the cron service
   * Starts all enabled jobs and optionally runs those with runOnInit=true
   */
  public async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Start all enabled jobs
    for (const [name, jobState] of this.jobs.entries()) {
      const isEnabled = this.isJobEnabled(jobState.config);

      if (isEnabled) {
        this.startJobInternal(name, jobState);
      }
    }

    // Run jobs that have runOnInit=true
    for (const [name, jobState] of this.jobs.entries()) {
      const isEnabled = this.isJobEnabled(jobState.config);

      if (isEnabled && jobState.config.runOnInit === true) {
        logger.info({ job: name }, 'Running job on init');
        try {
          await Promise.resolve(jobState.config.task());
        } catch (error) {
          logger.error({ job: name, err: error }, 'Error running job on init');
        }
      }
    }

    this.initialized = true;
  }

  /**
   * Add a new cron job
   * If the service is already initialized, the job will start immediately if enabled
   */
  public addJob(job: CronJobConfig): void {
    if (this.jobs.has(job.name)) {
      throw new Error(`Cron job "${job.name}" already exists`);
    }

    // Validate cron expression
    if (!cron.validate(job.schedule)) {
      throw new Error(`Invalid cron expression "${job.schedule}" for job "${job.name}"`);
    }

    const jobState: JobState = {
      config: job,
      task: null,
      running: false,
    };

    this.jobs.set(job.name, jobState);

    // If service is initialized and job is enabled, start it immediately
    if (this.initialized && this.isJobEnabled(job)) {
      this.startJobInternal(job.name, jobState);
    }
  }

  /**
   * Remove a cron job
   * Stops the job if it's running
   */
  public removeJob(name: string): void {
    const jobState = this.jobs.get(name);
    if (!jobState) {
      throw new Error(`Cron job "${name}" not found`);
    }

    // Stop the job if it's running
    if (jobState.task) {
      jobState.task.stop();
    }

    this.jobs.delete(name);
  }

  /**
   * Start a specific job
   * Only works if the job is enabled
   */
  public startJob(name: string): void {
    const jobState = this.jobs.get(name);
    if (!jobState) {
      throw new Error(`Cron job "${name}" not found`);
    }

    if (!this.isJobEnabled(jobState.config)) {
      logger.warn({ job: name }, 'Job is disabled, skipping start');
      return;
    }

    if (jobState.running) {
      logger.warn({ job: name }, 'Job is already running');
      return;
    }

    this.startJobInternal(name, jobState);
  }

  /**
   * Stop a specific job
   */
  public stopJob(name: string): void {
    const jobState = this.jobs.get(name);
    if (!jobState) {
      throw new Error(`Cron job "${name}" not found`);
    }

    if (jobState.task) {
      jobState.task.stop();
      jobState.task = null;
      jobState.running = false;
      logger.info({ job: name }, 'Stopped job');
    }
  }

  /**
   * Get all registered jobs with their status
   */
  public getJobs(): Array<{ name: string; schedule: string; enabled: boolean; running: boolean }> {
    return Array.from(this.jobs.entries()).map(([name, jobState]) => ({
      name,
      schedule: jobState.config.schedule,
      enabled: this.isJobEnabled(jobState.config),
      running: jobState.running,
    }));
  }

  /**
   * Stop all cron jobs
   */
  public stopAll(): void {
    for (const jobState of this.jobs.values()) {
      if (jobState.task) {
        jobState.task.stop();
        jobState.task = null;
        jobState.running = false;
      }
    }
    logger.info('All cron jobs stopped');
  }

  /**
   * Check if a job is enabled based on its config
   */
  private isJobEnabled(config: CronJobConfig): boolean {
    if (config.enabled === undefined) {
      return true; // Default to enabled
    }

    if (typeof config.enabled === 'boolean') {
      return config.enabled;
    }

    // It's a function
    try {
      return config.enabled();
    } catch (error) {
      logger.error({ job: config.name, err: error }, 'Error evaluating enabled function');
      return false;
    }
  }

  /**
   * Internal method to start a job
   */
  private startJobInternal(name: string, jobState: JobState): void {
    const { config } = jobState;

    const task = cron.schedule(
      config.schedule,
      async () => {
        logger.debug({ job: name, schedule: config.schedule }, 'Executing job');
        try {
          await Promise.resolve(config.task());
        } catch (error) {
          logger.error({ job: name, err: error }, 'Error executing job');
        }
      },
      {
        timezone: config.timezone ?? 'UTC',
      }
    );

    // task is created in paused state by default, so start it
    task.start();

    jobState.task = task;
    jobState.running = true;
    logger.info({ job: name, schedule: config.schedule }, 'Started job');
  }
}
