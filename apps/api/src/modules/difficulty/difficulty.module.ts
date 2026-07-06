import { Module, forwardRef } from '@nestjs/common';
import { SportsModule } from '../sports/sports.module';
import { DifficultyService } from './difficulty.service';

@Module({
  imports: [forwardRef(() => SportsModule)],
  providers: [DifficultyService],
  exports: [DifficultyService],
})
export class DifficultyModule {}
