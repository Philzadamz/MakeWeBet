import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsController } from './reports.controller';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController],
})
export class AdminModule {}
