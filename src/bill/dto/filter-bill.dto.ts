import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsOptional,
  IsString,
  IsNumber,
  IsDate,
  IsEnum,
} from 'class-validator';

export enum BillStatus {
  ACTIVE = 'ACTIVE',
  COMPLETED = 'COMPLETED'
}

export class FilterBillDto {
  @ApiProperty({
    description: 'Búsqueda por operación, código o subservicio',
    required: false,
    example: 'proyecto'
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiProperty({
    description: 'ID del área de trabajo',
    required: false,
    example: 1
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  jobAreaId?: number;

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

  @ApiProperty({
    description: 'Número de página',
    required: false,
    default: 1,
    example: 1
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  page?: number = 1;

  @ApiProperty({
    description: 'Elementos por página (máximo: 100)',
    required: false,
    default: 20,
    example: 20
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  limit?: number = 20;
}