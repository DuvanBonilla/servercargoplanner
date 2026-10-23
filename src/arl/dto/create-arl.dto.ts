import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { StatusActivation } from '@prisma/client';
import { Transform } from 'class-transformer';
import {
  IsEnum,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreateArlDto {
  @ApiProperty({ example: 'NOMBRE ARL' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '800000000-1' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s.]/g, '') : value,
  )
  @Matches(/^\d{6,12}(-\d)?$/, {
    message: 'nit must contain only digits and optionally the check digit (e.g. 800000000-1)',
  })
  nit: string;

  @ApiProperty({ example: `${Object.keys(StatusActivation).join(', ')}`, required: false })
  @IsOptional()
  @IsEnum(StatusActivation, {
    message: `Status must be one of the following: ${Object.keys(StatusActivation).join(', ')}`,
  })
  status?: StatusActivation;

  @ApiHideProperty()
  @IsNumber()
  @IsOptional()
  id_user: number;
}
