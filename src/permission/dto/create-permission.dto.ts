import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
} from 'class-validator';

export class CreatePermissionDto {
  @ApiProperty({ example: '2021-09-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateDisableStart debe tener formato YYYY-MM-DD',
  })
  dateDisableStart: string;

  @ApiProperty({ example: '08:00' })
  @IsString()
  @Matches(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/, {
    message: 'timeStart debe tener formato HH:MM',
  })
  timeStart: string;

  @ApiProperty({ example: '2021-10-01' })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateDisableEnd debe tener formato YYYY-MM-DD',
  })
  dateDisableEnd: string;

  @ApiProperty({ example: '17:00' })
  @IsString()
  @IsOptional()
  @Matches(/^([01]?[0-9]|2[0-3]):([0-5][0-9])$/, {
    message: 'timeEnd debe tener formato HH:MM',
  })
  timeEnd: string;
 
  @ApiProperty({ example: 'Motivo del permiso', required: true })
  @IsString()
  observation: string;

  @ApiProperty({ example: '128' })
  @Type(() => Number)
  @IsNumber()
  id_worker: number;

  @ApiHideProperty()
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  id_user: number;
}
