import { IsOptional, IsDateString } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';

export class WorkerDistributionQueryDto {
  @ApiPropertyOptional({
    description: 'Date in YYYY-MM-DD format. Default is today.',
    example: '2023-12-25',
    type: String,
  })
  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => value || new Date().toISOString().split('T')[0])
  date!: string;
}