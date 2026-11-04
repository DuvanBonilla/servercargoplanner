import { ApiProperty } from '@nestjs/swagger';

export class MinimumWageEntity {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 2026 })
  year: number;

  @ApiProperty({ example: 1750905, description: 'Monthly SMMLV in Colombian pesos' })
  value: number;

  @ApiProperty({ example: 58363.5, description: 'Daily value (value / 30): minimum daily IBC for the year' })
  dailyValue: number;

  @ApiProperty({ example: 36, description: 'User who registered the value' })
  id_user: number;

  @ApiProperty({ example: '2026-10-27T15:00:00.000Z' })
  createdAt: Date;

  @ApiProperty({ example: '2026-10-27T15:00:00.000Z' })
  updatedAt: Date;
}
