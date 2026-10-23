import { ApiProperty } from '@nestjs/swagger';
import { StatusActivation } from '@prisma/client';

export class CompanyEntity {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'CARGOBAN OPERADOR LOGISTICO S.A.' })
  name: string;

  @ApiProperty({ example: '900502659' })
  nit: string;

  @ApiProperty({ enum: StatusActivation, example: StatusActivation.ACTIVE })
  status: StatusActivation;

  @ApiProperty({ example: 1, nullable: true, description: 'Current ARL of the company' })
  id_arl: number | null;

  @ApiProperty({
    nullable: true,
    description: 'Current ARL of the company',
    example: { id: 1, name: 'NOMBRE ARL', nit: '800000000-1' },
  })
  arl: { id: number; name: string; nit: string } | null;

  @ApiProperty({ example: 1, description: 'User who registered the company' })
  id_user: number;

  @ApiProperty({ example: '2026-10-21T15:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-21T15:00:00.000Z' })
  updatedAt: Date;
}
