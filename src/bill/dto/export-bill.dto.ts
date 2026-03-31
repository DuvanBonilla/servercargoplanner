import { ApiProperty } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsDate,
  IsEnum,
  IsArray,
} from 'class-validator';
import { BillStatus } from './filter-bill.dto';

/**
 * DTO para exportar Bills a Excel
 * - Sin paginación: descarga TODOS los registros en el rango
 * - Múltiples áreas: jobAreaIds como array
 */
export class ExportBillDto {
  @ApiProperty({
    description: 'Búsqueda por operación, código o subservicio',
    required: false,
    example: 'proyecto'
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: 'IDs de áreas de trabajo (múltiples)',
    required: false,
    isArray: true,
    type: [Number],
    example: [1, 2, 3]
  })
  @IsOptional()
  @Type(() => Number)
  @IsArray()
  @Transform(({ value }) => {
    if (!value) return [];
    if (Array.isArray(value)) return value.map(v => Number(v));
    return [Number(value)]; // Si envían un solo valor, convertir a array
  })
  jobAreaIds?: number[];

  @ApiProperty({
    description: 'Estado de la factura',
    required: false,
    enum: BillStatus,
    example: BillStatus.ACTIVE
  })
  @IsOptional()
  @IsEnum(BillStatus)
  status?: BillStatus;

  @ApiProperty({
    description: 'Fecha de inicio (formato: YYYY-MM-DD)',
    required: false,
    example: '2024-01-01'
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateStart?: Date;

  @ApiProperty({
    description: 'Fecha de fin (formato: YYYY-MM-DD)',
    required: false,
    example: '2024-12-31'
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  dateEnd?: Date;
}
