import { IsInt, IsPositive } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AssignClientProgrammingDto {
  @ApiProperty({ description: 'ID de la operación a la que se asigna la programación' })
  @IsInt()
  @IsPositive()
  id_operation!: number;
}
