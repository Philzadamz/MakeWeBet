import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ContestsService } from './contests.service';
import { ContestQueue } from './contest.queue';
import { ContestLifecycleWorker } from './contest-lifecycle.worker';
import { ContestsController } from './contests.controller';
import { ContestsAdminController } from './contests-admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [ContestsController, ContestsAdminController],
  providers: [ContestsService, ContestQueue, ContestLifecycleWorker],
  exports: [ContestsService],
})
export class ContestsModule {}
