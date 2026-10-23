import { ApiProperty } from '@nestjs/swagger';
import { StatusActivation } from '@prisma/client';

export class ArlEntity {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'NOMBRE ARL' })
  name: string;

  @ApiProperty({ example: '800000000-1' })
  nit: string;

  @ApiProperty({ enum: StatusActivation, example: StatusActivation.ACTIVE })
  status: StatusActivation;

  @ApiProperty({ example: 1, description: 'User who registered the ARL' })
  id_user: number;

  @ApiProperty({ example: '2026-10-21T15:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-21T15:00:00.000Z' })
  updatedAt: Date;
}
