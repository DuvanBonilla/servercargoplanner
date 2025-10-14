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

  @ApiProperty({ example: '1' })
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  @IsOptional()
  group_hours: number;


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
  @ApiProperty({ example: '1' })
  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  id_operation: number;

  // @ApiProperty({ example: 'ACTIVE', enum: ['ACTIVE', 'COMPLETED'] })
  // @IsOptional()
  // @IsString()
  // status?: string;

  groups: GroupBillDto[];
}
