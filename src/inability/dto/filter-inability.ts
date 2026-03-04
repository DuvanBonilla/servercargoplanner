import { ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsNumber,
  IsString,
  Matches,
  IsEnum,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CauseDisability, TypeDisability } from '@prisma/client';

export class FilterInabilityDto {
  @ApiProperty({ required: false, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  id_worker?: number;

  @ApiProperty({ required: false, example: '2021-09-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateDisableStart debe tener formato YYYY-MM-DD',
  })
  dateDisableStart?: string;

  @ApiProperty({ required: false, example: '2025-05-07' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateDisableStart debe tener formato YYYY-MM-DD',
  })
  dateDisableEnd?: string;

  @ApiProperty({ required: false, example: `${Object.values(TypeDisability).join(', ')}` })
  @IsOptional()
  @IsEnum(TypeDisability, {
    message: `type debe ser uno de los siguientes valores: ${Object.values(TypeDisability).join(', ')}`,
  })
  type?: TypeDisability;

  @ApiProperty({ required: false, example: `${Object.values(CauseDisability).join(', ')}` })
  @IsOptional()
  @IsEnum(CauseDisability, {
    message: `cause debe ser uno de los siguientes valores: ${Object.values(CauseDisability).join(', ')}`,
  })
  cause?: CauseDisability;

  @ApiProperty({ required: false, example: '12345678' })
  @IsOptional()
  @IsString()
  dni?: string;

  @IsNumber()
  @IsOptional()
  id_site?: number;
}
