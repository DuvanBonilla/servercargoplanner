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

export class CreateEpsDto {
  @ApiProperty({ example: 'NUEVA EPS S.A.' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({ example: '900156264-2' })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.replace(/[\s.]/g, '') : value,
  )
  @Matches(/^\d{6,12}(-\d)?$/, {
    message: 'nit must contain only digits and optionally the check digit (e.g. 900156264-2)',
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
