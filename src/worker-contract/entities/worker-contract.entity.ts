import { ApiProperty } from '@nestjs/swagger';
import { WorkerType } from '@prisma/client';

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

  @ApiProperty({ example: '2026-12-31T00:00:00.000Z', nullable: true })
  endDate: Date | null;

  @ApiProperty({ enum: WorkerType, nullable: true, example: WorkerType.OPERATIVE })
  workerType: WorkerType | null;

  @ApiProperty({
    example: false,
    description: 'true = historical record created when a DEACTIVATED worker without history was reactivated; only endDate is known',
  })
  isLegacy: boolean;

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

  @ApiProperty({ example: 5, description: 'Days until endDate; negative when already expired' })
  daysLeft: number;
}
