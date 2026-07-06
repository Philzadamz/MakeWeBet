import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ReportsController } from './reports.controller';
import { UsersAdminController } from './users-admin.controller';
import { AuditAdminController } from './audit-admin.controller';

@Module({
  imports: [AuthModule],
  controllers: [ReportsController, UsersAdminController, AuditAdminController],
})
export class AdminModule {}
