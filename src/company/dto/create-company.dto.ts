import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { StatusActivation } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateCompanyDto {
  @ApiProperty({ example: 'CARGOBAN OPERADOR LOGISTICO S.A.' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '900502659' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s.]/g, '') : value,
  )
  @Matches(/^\d{6,12}(-\d)?$/, {
    message: 'nit must contain only digits and optionally the check digit (e.g. 900502659)',
  })
  nit: string;

  @ApiProperty({ example: `${Object.keys(StatusActivation).join(', ')}`, required: false })
  @IsOptional()
  @IsEnum(StatusActivation, {
    message: `Status must be one of the following: ${Object.keys(StatusActivation).join(', ')}`,
  })
  status?: StatusActivation;

  @ApiProperty({
    example: 1,
    required: false,
    nullable: true,
    description: 'Current ARL of the company (must exist and be ACTIVE). Send null to unassign.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'id_arl must be an integer' })
  id_arl?: number | null;

  @ApiHideProperty()
  @IsNumber()
  @IsOptional()
  id_user: number;
}
