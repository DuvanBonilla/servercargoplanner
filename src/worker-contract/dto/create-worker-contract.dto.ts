import { ApiHideProperty, ApiProperty, OmitType } from '@nestjs/swagger';
import { ContractType, WorkerType } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';

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

  @ApiProperty({ enum: ContractType, example: ContractType.FIXED_13_WEEKS, description: 'Contract modality' })
  @IsEnum(ContractType, {
    message: `contractType must be one of the following: ${Object.values(ContractType).join(', ')}`,
  })
  contractType: ContractType;

  @ApiProperty({ example: '2026-07-01', description: 'Contract start date (YYYY-MM-DD)' })
  @Matches(DATE_ONLY, { message: 'startDate must have the format YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({
    example: '2026-09-27',
    required: false,
    description:
      'Termination date (YYYY-MM-DD) confirmed by the user: 1 or 2 days before the stipulated expiry so the contract is not renewed automatically. ' +
      'If omitted, the date calculated for the contractType is used (see GET /worker/contracts/end-date). Required for OBRA_LABOR; not allowed for INDEFINITE.',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'endDate must have the format YYYY-MM-DD' })
  endDate?: string;

  @ApiProperty({
    example: 6,
    required: false,
    description: 'APPRENTICESHIP only: duration in months (6 to 12) used to calculate endDate when it is omitted',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'months must be an integer' })
  @Min(6, { message: 'months must be between 6 and 12' })
  @Max(12, { message: 'months must be between 6 and 12' })
  months?: number;

  @ApiProperty({ enum: WorkerType, example: WorkerType.OPERATIVE })
  @IsEnum(WorkerType, {
    message: `workerType must be one of the following: ${Object.values(WorkerType).join(', ')}`,
  })
  workerType: WorkerType;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'Relocated worker: the fixed-term or OBRA_LABOR contract stays in effect with no endDate until it is closed. Not allowed for INDEFINITE or APPRENTICESHIP.',
  })
  @IsOptional()
  @IsBoolean({ message: 'isRelocated must be true or false' })
  isRelocated?: boolean;

  @ApiHideProperty()
  @IsOptional()
  @IsInt()
  id_user: number;
}

// Cuerpo de POST /worker/:id/contracts y del contrato al crear/reactivar un trabajador
export class WorkerContractBodyDto extends OmitType(CreateWorkerContractDto, ['id_worker', 'id_user'] as const) {}
