import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

export enum ExportReportType {
  WORKER = 'WORKER',
  NORMAL = 'NORMAL',
}

// Funciones de normalización para manejar tanto arrays como strings separados por comas
function normalizeArrayOfStrings(value: unknown): string[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter((v) => !!v);
  }
  return undefined;
}

// Función de normalización para convertir a array de números, manejando tanto arrays como strings separados por comas
function normalizeArrayOfNumbers(value: unknown): number[] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) {
    return value
      .map((v) => Number(v))
      .filter((v) => Number.isInteger(v) && v > 0);
  }
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => Number(v.trim()))
      .filter((v) => Number.isInteger(v) && v > 0);
  }
  return undefined;
}

// DTO para los filtros de exportación
export class ExportFiltersDto {
  @ApiPropertyOptional({ example: '2026-03-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateStart debe tener formato YYYY-MM-DD',
  })
  dateStart?: string;

  @ApiPropertyOptional({ example: '2026-03-19' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'dateEnd debe tener formato YYYY-MM-DD',
  })
  dateEnd?: string;

  @ApiPropertyOptional({
    isArray: true,
    type: String,
    example: ['PENDING', 'INPROGRESS'],
  })
  @IsOptional()
  @Transform(({ value }) => normalizeArrayOfStrings(value))
  @IsArray()
  @IsString({ each: true })
  status?: string[];

  @ApiPropertyOptional({ isArray: true, type: Number, example: [1, 2, 3] })
  @IsOptional()
  @Transform(({ value }) => normalizeArrayOfNumbers(value))
  @IsArray()
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  jobAreaIds?: number[];

  @ApiPropertyOptional({ example: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  inChargedId?: number;

  @ApiPropertyOptional({ example: 'muelle norte' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  excludeCanceled?: boolean = true;

  @ApiPropertyOptional({ default: 'America/Bogota' })
  @IsOptional()
  @IsString()
  timezone?: string = 'America/Bogota';
}

// DTO principal para la exportación de operaciones
export class ExportOperationsDto {
  @ApiProperty({ enum: ExportReportType, example: ExportReportType.WORKER })
  @IsEnum(ExportReportType)
  reportType: ExportReportType;

  @ApiPropertyOptional({ type: ExportFiltersDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ExportFiltersDto)
  filters?: ExportFiltersDto;
}
