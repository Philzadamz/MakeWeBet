import { Global, Module } from '@nestjs/common';
import { OutboxService } from './outbox.service';
import { OutboxRelay } from './outbox.relay';

@Global()
@Module({
  providers: [OutboxService, OutboxRelay],
  exports: [OutboxService],
})
export class OutboxModule {}
