import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import type Redis from 'ioredis';
import { REDIS } from '../../infrastructure/redis/redis.module';
import { SyncService } from './sync.service';

/**
 * Keeps upcoming fixtures fresh without an admin clicking sync per date:
 * daily at 06:00 (plus a catch-up run shortly after boot), pulls today
 * through +9 days from the provider. One provider request per day synced —
 * trivially within even football-data.org's 10 req/min free tier.
 *
 * Enabled only on worker pods (RUN_WORKERS) AND only when a real provider
 * key is configured — with the dev/test mock, auto-fabricating fixtures
 * every day would just pollute the database. A short Redis lock keeps
 * multiple worker replicas from running the same sweep concurrently
 * (sync is idempotent anyway; the lock only avoids wasted quota).
 */
@Injectable()
export class FixturesSyncScheduler implements OnModuleInit, OnModuleDestroy {
  private static readonly DAYS_AHEAD = 10;
  private static readonly LOCK_KEY = 'fiq:fixtures-auto-sync:lock';
  private readonly logger = new Logger(FixturesSyncScheduler.name);
  private readonly enabled: boolean;
  private bootTimer?: NodeJS.Timeout;

  constructor(
    private readonly sync: SyncService,
    @Inject(REDIS) private readonly redis: Redis,
    config: ConfigService,
  ) {
    const hasRealProvider = Boolean(
      config.get('FOOTBALL_DATA_KEY') || config.get('API_FOOTBALL_KEY'),
    );
    this.enabled = Boolean(config.get('RUN_WORKERS')) && hasRealProvider;
  }

  onModuleInit(): void {
    if (!this.enabled) return;
    // Catch-up shortly after boot so a fresh deploy doesn't wait for 06:00.
    this.bootTimer = setTimeout(() => void this.run('boot'), 15_000);
  }

  @Cron(CronExpression.EVERY_DAY_AT_6AM)
  async daily(): Promise<void> {
    if (!this.enabled) return;
    await this.run('cron');
  }

  private async run(trigger: 'boot' | 'cron'): Promise<void> {
    const lock = await this.redis.set(
      FixturesSyncScheduler.LOCK_KEY,
      trigger,
      'EX',
      600,
      'NX',
    );
    if (!lock) {
      this.logger.log(`auto-sync (${trigger}) skipped — another instance holds the lock`);
      return;
    }

    let created = 0;
    let updated = 0;
    let failedDays = 0;
    for (let i = 0; i < FixturesSyncScheduler.DAYS_AHEAD; i++) {
      const date = new Date(Date.now() + i * 24 * 3600 * 1000);
      try {
        const result = await this.sync.syncDate(date);
        created += result.created;
        updated += result.updated;
      } catch (err) {
        failedDays += 1;
        this.logger.warn(
          `auto-sync failed for ${date.toISOString().slice(0, 10)}: ${String(err)}`,
        );
      }
    }
    this.logger.log(
      `auto-sync (${trigger}): ${created} created, ${updated} updated over ` +
        `${FixturesSyncScheduler.DAYS_AHEAD} days${failedDays ? `, ${failedDays} day(s) failed` : ''}`,
    );
  }

  onModuleDestroy(): void {
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }
}
