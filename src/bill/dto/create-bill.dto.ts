import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { AdditionalHours } from '../entities/worker-group-analysis.types';
import { Decimal } from '@prisma/client/runtime/library';

export class HoursDistribution {
  @ApiProperty({ example: '1' })
  @IsNumber()
  HOD: number;
  @IsNumber()
  @ApiProperty({ example: '0' })
  HON: number;
  @IsNumber()
  @ApiProperty({ example: '2' })
  HED: number;
  @IsNumber()
  @ApiProperty({ example: '0' })
  HEN: number;
  @IsNumber()
  @ApiProperty({ example: '0' })
  HFOD: number;
  @IsNumber()
  @ApiProperty({ example: '0' })
  HFON: number;
  @IsNumber()
  @ApiProperty({ example: '0' })
  HFED: number;
  @IsNumber()
  @ApiProperty({ example: '0' })
  HFEN: number;
}

export class GroupBillDto {
  @ApiProperty({ example: '1' })
  @IsString()
  id: string;

  @ApiProperty({ description: 'Distribuccion horaria para facturacion' })
  billHoursDistribution: HoursDistribution;

  @ApiProperty({ description: 'Distribuccion horaria para nomina' })
  paysheetHoursDistribution: HoursDistribution;

  @ApiProperty({ example: '1' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  amount: number;

  @ApiProperty({ 
    example: 1,
    description: 'Duración total en horas del grupo (opcional). Este valor se calcula automáticamente desde las fechas de Operation_Worker. Solo se usa al crear la factura inicialmente.',
    required: false
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  group_hours: Decimal;


  @ApiProperty({ example: 'Observation text' })
  @IsString()
  @IsOptional()
  @Type(() => String)
  observation?: string;


  @IsOptional()
  @ValidateNested({ each: true })
  pays: WorkerPay[];

   @IsOptional()
  @IsObject()
  compensatory?: {
    hours: number;
    amount: number;
    percentage: number;
  };
}

export class WorkerPay {
  @ApiProperty({ example: '1' })
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  id_worker: number;

  @ApiProperty({ example: '1.5' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  pay: number;
}

export class CreateBillDto {
  @ApiProperty({ example: '1', description: 'ID de la operación a facturar' })
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  id_operation: number;

  @ApiProperty({ 
    description: 'Grupos de trabajadores con sus distribuciones horarias y pagos',
    type: [GroupBillDto]
  })
  @ValidateNested({ each: true })
  @Type(() => GroupBillDto)
  groups: GroupBillDto[];
}
