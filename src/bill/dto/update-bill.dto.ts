import { ApiProperty, PartialType } from '@nestjs/swagger';
import { CreateBillDto, HoursDistribution, WorkerPay } from './create-bill.dto';
import { IsNumber, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { IsEnum } from 'class-validator';
import { BillStatus } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';

/**
 * DTO para actualizar un Bill existente.
 * 
 * IMPORTANTE: El campo 'group_hours' NO se envía en este DTO porque se calcula
 * automáticamente desde las fechas de Operation_Worker cuando se actualizan.
 * 
 * Las fechas de inicio/fin del grupo provienen de Operation_Worker (no de Operation),
 * lo que permite que cada grupo tenga duraciones diferentes dentro de la misma operación.
 */
export class UpdateBillDto {
  @ApiProperty({ 
    example: 'd1de43a7-cfdd-4950-8238-73374038f927',
    description: 'ID del grupo (id_group) al que pertenece este bill dentro de la operación. Este es el UUID que identifica al grupo de trabajadores, NO es el ID del bill.',
    required: false
  })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ 
    description: 'Distribución horaria para facturación (opcional)',
    required: false,
    example: {
      "HOD": 0,
      "HON": 0,
      "HED": 2,
      "HEN": 0,
      "HFOD": 0,
      "HFON": 0,
      "HFED": 0,
      "HFEN": 0
    }
  })
  @IsOptional()
  billHoursDistribution: HoursDistribution;

  @ApiProperty({ 
    description: 'Distribución horaria para nómina (opcional)',
    required: false,
    example: {
      "HOD": 0,
      "HON": 0,
      "HED": 2,
      "HEN": 0,
      "HFOD": 0,
      "HFON": 0,
      "HFED": 0,
      "HFEN": 0
    }
  })
  @IsOptional()
  paysheetHoursDistribution: HoursDistribution;

  @ApiProperty({ 
    example: 0,
    description: 'Cantidad de unidades/servicios prestados (opcional). Usado para grupos por cantidad.',
    required: false
  })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  amount: number;

  @ApiProperty({ example: 'ad789802-eb77-4593-8a21-8f23a9883e17' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  group_hours: Decimal;

  @ApiProperty({ 
    example: 'Duración ajustada por cambio en fechas de trabajadores',
    description: 'Observación o nota sobre el bill (opcional)',
    required: false
  })
  @IsString()
  @IsOptional()
  @Type(() => String)
  observation?: string;

  // ✅ FECHAS DEL GRUPO - para modificar operation_worker específicos
  @ApiProperty({
    example: '2026-01-09T00:00:00.000Z',
    description: 'Fecha de inicio del grupo (opcional). Cuando se proporciona, actualiza las fechas de todos los operation_worker de este grupo.',
    required: false
  })
  @IsOptional()
  @Type(() => Date)
  dateStart_group?: Date;

  @ApiProperty({
    example: '01:00',
    description: 'Hora de inicio del grupo (opcional). Formato HH:mm',
    required: false
  })
  @IsString()
  @IsOptional()
  timeStart_group?: string;

  @ApiProperty({
    example: '2026-01-09T00:00:00.000Z',
    description: 'Fecha de fin del grupo (opcional). Cuando se proporciona, actualiza las fechas de todos los operation_worker de este grupo.',
    required: false
  })
  @IsOptional()
  @Type(() => Date)
  dateEnd_group?: Date;

  @ApiProperty({
    example: '15:24',
    description: 'Hora de fin del grupo (opcional). Formato HH:mm',
    required: false
  })
  @IsString()
  @IsOptional()
  timeEnd_group?: string;


  @ApiProperty({
    description: 'Array de pagos por trabajador (opcional). Indica cuántas unidades de pago corresponden a cada trabajador del grupo.',
    required: false,
    example: [
      {
        "id_worker": 732,
        "pay": 1.0
      },
      {
        "id_worker": 606,
        "pay": 1.5
      }
    ]
  })
  @IsOptional()
  @ValidateNested({ each: true })
  pays: WorkerPay[];

  
}

export class UpdateBillStatusDto {
  @ApiProperty({ 
    example: 'COMPLETED', 
    enum: BillStatus,
    description: 'Estado de la factura'
  })
  @IsEnum(BillStatus, {
    message: `status debe ser uno de los siguientes valores: ${Object.values(BillStatus).join(', ')}`,
  })
  status: BillStatus;
}