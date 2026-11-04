import {  IsEnum, IsNumber, IsOptional, IsString, Matches, IsDate, IsDefined, ValidateNested } from 'class-validator';
import { Status } from '@prisma/client';
import { Type, Transform } from 'class-transformer';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { WorkerContractBodyDto } from 'src/worker-contract/dto/create-worker-contract.dto';

/**
 * @category DTOs
 */
export class CreateWorkerDto {
  @ApiProperty({ example: '000-000-000' })
  @IsString()
  dni: string;

  @ApiProperty({ example: 'HGT7895' })
  @IsString()
  code: string;

  @ApiProperty({ example: 'HGT7895' })
  @IsString()
  payroll_code: string;

  @ApiProperty({ example: '3222###' })
  @IsString()
  phone: string;

  @ApiProperty({example:"5"})
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  hoursWorked?: number;

  @ApiProperty({example:"3"})
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  failures?: number;

  @ApiProperty({ example: 'John' })
  @IsString()
  name: string;

  @ApiProperty({ example: `${Object.values(Status).join(', ')}` })
  @IsEnum(Status, {
    message: `status debe ser uno de los siguientes valores: ${Object.values(Status).join(', ')}`,
  })
  status: Status;

  @ApiProperty({ example: '12' })
  @IsNumber()
  @Type(() => Number)
  id_area: number;

  @ApiHideProperty()
  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  id_user?: number;

  @ApiProperty({ example: '2021-09-01' })
  @Transform(({ value }) => {
    if (value instanceof Date) return value;
    if (typeof value === 'string') return new Date(value);
    return value;
  })
  @IsDate()
  @IsOptional()
  dateDisableStart: Date;

  @ApiProperty({ example: '2021-10-01' })
  @Transform(({ value }) => {
    if (value instanceof Date) return value;
    if (typeof value === 'string') return new Date(value);
    return value;
  })
  @IsDate()
  @IsOptional()
  dateDisableEnd: Date;

  @ApiProperty({ example: '2021-10-01' })
  @Transform(({ value }) => {
    if (value instanceof Date) return value;
    if (typeof value === 'string') return new Date(value);
    return value;
  })
  @IsDate()
  @IsOptional()
  dateRetierment: Date;

  @ApiHideProperty()
  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  id_site?: number;

  @ApiHideProperty()
  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  id_subsite?: number;

  @ApiProperty({
    type: () => WorkerContractBodyDto,
    description:
      'Contract of the worker. Required when creating a worker and when reactivating a DEACTIVATED worker (PATCH); ' +
      'not accepted in other updates (use POST /worker/:id/contracts).',
  })
  @IsDefined({ message: 'contract is required: every active worker must have a contract' })
  @ValidateNested()
  @Type(() => WorkerContractBodyDto)
  contract: WorkerContractBodyDto;
}
