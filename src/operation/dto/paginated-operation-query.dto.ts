import { ApiProperty } from '@nestjs/swagger';
import { StatusOperation } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';

export class PaginatedOperationQueryDto {
  @ApiProperty({
    description: 'Número de página para paginación',
    required: false,
    default: 1,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiProperty({
    description: 'Elementos por página (máximo: 500, recomendado: 100 para grandes datasets)',
    required: false,
    default: 10,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 10;

  @ApiProperty({
    description: 'Estado(s) de las operaciones',
    required: false,
    enum: StatusOperation,
    isArray: true,
  })
  @IsOptional()
  @Transform(({ value }) => {
    // Si es un array, devolver el array
    if (Array.isArray(value)) {
      return value;
    }
    // Si es un string, transformarlo a un array
    if (typeof value === 'string') {
      // Si contiene comas, dividirlo
      if (value.includes(',')) {
        return value.split(',');
      }
      // Si es un solo valor, convertirlo a array
      return [value];
    }
    // Valor por defecto
    return [];
  })
  @IsEnum(StatusOperation, { each: true })
  status?: StatusOperation[];

  @ApiProperty({
    description: 'Fecha de inicio mínima (formato: YYYY-MM-DD)',
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateStart?: Date;

  @ApiProperty({
    description: 'Fecha de fin máxima (formato: YYYY-MM-DD)',
    required: false,
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateEnd?: Date;

  @ApiProperty({
    description: 'ID del área de trabajo',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  jobAreaId?: number;

  @ApiProperty({
    description: 'ID del usuario asociado',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  userId?: number;

  @ApiProperty({
    description: 'ID del usuario encargado',
    required: false,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  inChargedId?: number;

  @ApiProperty({
    description: 'Texto para búsqueda en descripción, cliente o área',
    required: false,
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: 'Activar/desactivar paginación',
    required: false,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  activatePaginated?: boolean;
}
