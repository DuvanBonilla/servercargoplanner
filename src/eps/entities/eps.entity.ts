import { ApiProperty } from '@nestjs/swagger';
import { StatusActivation } from '@prisma/client';

export class EpsEntity {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'NUEVA EPS S.A.' })
  name: string;

  @ApiProperty({ example: '900156264-2' })
  nit: string;

  @ApiProperty({ enum: StatusActivation, example: StatusActivation.ACTIVE })
  status: StatusActivation;

  @ApiProperty({ example: 1, description: 'User who registered the EPS' })
  id_user: number;

  @ApiProperty({ example: '2026-10-21T15:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-21T15:00:00.000Z' })
  updatedAt: Date;
}
