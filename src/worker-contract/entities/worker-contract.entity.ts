import { ApiProperty } from '@nestjs/swagger';
import { ContractType, WorkerType } from '@prisma/client';

export class WorkerContractEntity {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 128 })
  id_worker: number;

  @ApiProperty({ example: 2, nullable: true })
  id_company: number | null;

  @ApiProperty({
    nullable: true,
    example: { id: 2, name: 'CARGOBAN OPERADOR LOGISTICO S.A.', nit: '900502659', arl: { id: 1, name: 'NOMBRE ARL' } },
  })
  company: object | null;

  @ApiProperty({ example: '2026-07-01T00:00:00.000Z', nullable: true })
  startDate: Date | null;

  @ApiProperty({ example: '2026-09-29T00:00:00.000Z', nullable: true, description: 'null = INDEFINITE or relocated contract still in effect' })
  endDate: Date | null;

  @ApiProperty({ enum: WorkerType, nullable: true, example: WorkerType.OPERATIVE })
  workerType: WorkerType | null;

  @ApiProperty({ enum: ContractType, nullable: true, example: ContractType.FIXED_13_WEEKS })
  contractType: ContractType | null;

  @ApiProperty({
    example: false,
    description: 'true = historical record created when a DEACTIVATED worker without history was reactivated; only endDate is known',
  })
  isLegacy: boolean;

  @ApiProperty({ example: false, description: 'true = relocated worker: the contract stays in effect with no endDate until it is closed' })
  isRelocated: boolean;

  @ApiProperty({ example: 36, description: 'User who registered the contract' })
  id_user: number;

  @ApiProperty({ example: '2026-10-23T15:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-23T15:00:00.000Z' })
  updatedAt: Date;
}

export class ExpiringContractEntity extends WorkerContractEntity {
  @ApiProperty({ example: { id: 128, name: 'JUAN PEREZ', dni: '1082927152', status: 'AVALIABLE' } })
  worker: object;

  @ApiProperty({ example: 2, description: 'Days until endDate; negative when already expired' })
  daysLeft: number;
}

export class ContractEndDateEntity {
  @ApiProperty({ enum: ContractType, example: ContractType.FIXED_13_WEEKS })
  contractType: ContractType;

  @ApiProperty({ example: '2026-07-01' })
  startDate: string;

  @ApiProperty({
    example: '2026-09-29',
    nullable: true,
    description: 'Stipulated expiry of the contract term (for OBRA_LABOR, the one sent by the user)',
  })
  stipulatedEndDate: string | null;

  @ApiProperty({
    example: '2026-09-27',
    nullable: true,
    description:
      'Termination date to register: terminationDaysBefore days before the stipulated expiry, so the contract is not renewed automatically (null for INDEFINITE, or OBRA_LABOR without stipulatedEndDate)',
  })
  suggestedEndDate: string | null;

  @ApiProperty({ example: 2, description: 'Days before the stipulated expiry the contract is terminated (OBRA_LABOR, FIXED_13_WEEKS and FIXED_1_YEAR: 2, FIXED_3_MONTHS: 1)' })
  terminationDaysBefore: number;

  @ApiProperty({ example: null, nullable: true, description: 'Minimum allowed termination date (APPRENTICESHIP)' })
  minEndDate: string | null;

  @ApiProperty({ example: '2026-09-27', nullable: true, description: 'Maximum allowed termination date when registering' })
  maxEndDate: string | null;

  @ApiProperty({ example: true, description: 'false for INDEFINITE contracts' })
  endDateRequired: boolean;
}

