import { StatusOperation } from '@prisma/client';
import {
  IsOptional,
  IsString,
  IsDate,
  IsNumber,
  IsArray,
  IsEnum,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class OperationFilterDto {

  
  @IsOptional()
  @IsArray()
  @IsEnum(StatusOperation, { each: true })
  status?: StatusOperation[];

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  dateStart?: Date;

  @IsOptional()
  @IsDate()
  @Type(() => Date)
  dateEnd?: Date;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  jobAreaId?: number;

  @IsOptional()
  @Transform(({ value }) => {
    // Si es un string que contiene comas, dividirlo y convertirlo a un array de números
    if (typeof value === 'string' && value.includes(',')) {
      return value.split(',').map((id) => parseInt(id.trim(), 10));
    }
    // Si es un único valor numérico como string, convertirlo a número
    else if (typeof value === 'string') {
      return parseInt(value, 10);
    }
    // Si ya es un número o un array, devolverlo tal cual
    return value;
  })
  userId?: number | number[];

  @IsOptional()
  @Transform(({ value }) => {
    // Si es un string que contiene comas, dividirlo y convertirlo a un array de números
    if (typeof value === 'string' && value.includes(',')) {
      return value.split(',').map((id) => parseInt(id.trim(), 10));
    }
    // Si es un único valor numérico como string, convertirlo a número
    else if (typeof value === 'string') {
      return parseInt(value, 10);
    }
    // Si ya es un número o un array, devolverlo tal cual
    return value;
  })
  inChargedId?: number | number[];

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  id_subsite?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  id_site?: number;
}
