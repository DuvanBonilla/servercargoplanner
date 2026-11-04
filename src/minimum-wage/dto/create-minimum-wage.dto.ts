import { ApiHideProperty, ApiProperty, OmitType, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class CreateMinimumWageDto {
  @ApiProperty({ example: 2026, description: 'Year the minimum wage applies to' })
  @Type(() => Number)
  @IsInt({ message: 'year must be an integer' })
  @Min(2000, { message: 'year must be between 2000 and 2100' })
  @Max(2100, { message: 'year must be between 2000 and 2100' })
  year: number;

  @ApiProperty({ example: 1750905, description: 'Monthly legal minimum wage (SMMLV) in Colombian pesos' })
  @Type(() => Number)
  @IsInt({ message: 'value must be an integer amount of pesos' })
  @Min(1, { message: 'value must be greater than 0' })
  value: number;

  @ApiHideProperty()
  @IsOptional()
  @IsInt()
  id_user: number;
}

export class UpdateMinimumWageDto extends PartialType(OmitType(CreateMinimumWageDto, ['id_user'] as const)) {}
