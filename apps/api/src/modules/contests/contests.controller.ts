import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ContestsService } from './contests.service';

@ApiTags('contests')
@Controller('contests')
export class ContestsController {
  constructor(private readonly contests: ContestsService) {}

  @Get()
  @ApiOperation({ summary: 'Open contests with live estimated prize pools' })
  list() {
    return this.contests.listOpen();
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Contest detail: matches, difficulty stars, slots' })
  detail(@Param('slug') slug: string) {
    return this.contests.getBySlug(slug);
  }
}
