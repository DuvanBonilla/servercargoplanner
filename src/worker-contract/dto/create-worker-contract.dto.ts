import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { WorkerType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Matches } from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateWorkerContractDto {
  @ApiProperty({ example: 128, description: 'Worker id' })
  @Type(() => Number)
  @IsInt({ message: 'id_worker must be an integer' })
  id_worker: number;

  @ApiProperty({ example: 2, description: 'Hiring company id (must be ACTIVE)' })
  @Type(() => Number)
  @IsInt({ message: 'id_company must be an integer' })
  id_company: number;

  @ApiProperty({ example: '2026-07-01', description: 'Contract start date (YYYY-MM-DD)' })
  @Matches(DATE_ONLY, { message: 'startDate must have the format YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({ example: '2026-12-31', description: 'Contract end date (YYYY-MM-DD). Required' })
  @Matches(DATE_ONLY, { message: 'endDate must have the format YYYY-MM-DD' })
  endDate: string;

  @ApiProperty({ enum: WorkerType, example: WorkerType.OPERATIVE })
  @IsEnum(WorkerType, {
    message: `workerType must be one of the following: ${Object.values(WorkerType).join(', ')}`,
  })
  workerType: WorkerType;

  @ApiHideProperty()
  @IsOptional()
  @IsInt()
  id_user: number;
}
