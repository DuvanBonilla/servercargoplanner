import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { JwtAuthGuard } from 'src/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/auth/guards/roles.guard';
import { Roles } from 'src/auth/decorators/roles.decorator';
import { getColombianToday } from 'src/common/utils/dateColombia';
import { AiUsageService } from './ai-usage.service';
import { AiUsageLogEntity, AiUsageSummaryEntity } from './entities/ai-usage.entity';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

@ApiTags('AI usage')
@Controller('ai-usage')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN, Role.ADMIN)
@ApiResponse({ status: 401, description: 'Missing, invalid or expired token' })
@ApiResponse({ status: 403, description: 'User role is not allowed (SUPERADMIN, ADMIN)' })
export class AiUsageController {
  constructor(private readonly aiUsageService: AiUsageService) {}

  @Get('summary')
  @ApiOperation({
    summary: 'Monthly AI usage',
    description: 'Calls, tokens and cost (USD) of AI models per month of a year (Colombian time), with the detail per model.',
  })
  @ApiQuery({ name: 'year', required: false, type: Number, example: 2026, description: 'Default: current year' })
  @ApiResponse({ status: 200, description: 'Usage per month', type: AiUsageSummaryEntity })
  @ApiResponse({ status: 400, description: 'Invalid year' })
  summary(@Query('year') year?: string) {
    const parsed = year === undefined ? getColombianToday().getUTCFullYear() : Number(year);
    if (!Number.isInteger(parsed) || parsed < 2000 || parsed > 2100) {
      throw new BadRequestException('year must be between 2000 and 2100');
    }
    return this.aiUsageService.monthlySummary(parsed);
  }

  @Get()
  @ApiOperation({ summary: 'List AI usage', description: 'Each AI call between two dates (inclusive, Colombian time), most recent first.' })
  @ApiQuery({ name: 'from', required: true, type: String, example: '2026-10-01', description: 'YYYY-MM-DD' })
  @ApiQuery({ name: 'to', required: true, type: String, example: '2026-10-31', description: 'YYYY-MM-DD' })
  @ApiResponse({ status: 200, description: 'AI calls', type: [AiUsageLogEntity] })
  @ApiResponse({ status: 400, description: 'Invalid dates' })
  findAll(@Query('from') from: string, @Query('to') to: string) {
    if (!DATE_ONLY.test(from ?? '') || !DATE_ONLY.test(to ?? '') || from > to) {
      throw new BadRequestException('from and to must have the format YYYY-MM-DD and from <= to');
    }
    return this.aiUsageService.findAll(from, to);
  }
}
