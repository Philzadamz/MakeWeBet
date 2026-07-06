import { Global, Module } from '@nestjs/common';
import { LiveGateway } from './live.gateway';
import { LivePublisher } from './live-publisher.service';

@Global()
@Module({
  providers: [LiveGateway, LivePublisher],
  exports: [LivePublisher],
})
export class LiveModule {}
