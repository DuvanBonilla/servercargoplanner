import { PartialType, ApiProperty } from '@nestjs/swagger';
import { CreateClientProgrammingDto } from './create-client-programming.dto';
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class UpdateClientProgrammingDto extends PartialType(CreateClientProgrammingDto) {
  @ApiProperty({
    example: 1,
    required: false,
    description: 'ID de la operación a asignar (requerido cuando status cambia a ASSIGNED)',
  })
  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  id_operation?: number;

  @ApiProperty({
    example: false,
    required: false,
    description:
      'Forzar asignación aunque la operación ya tenga una programación asignada (confirmación del usuario)',
  })
  @IsBoolean()
  @IsOptional()
  force_assign?: boolean;
}
