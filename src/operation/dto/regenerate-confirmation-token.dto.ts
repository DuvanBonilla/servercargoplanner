import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, IsPositive } from 'class-validator';

export class RegenerateConfirmationTokenDto {
  @ApiProperty({
    description: 'ID de la operación especial para la cual regenerar el token',
    example: 123,
    type: 'number',
  })
  @IsNumber()
  @IsPositive()
  operationId!: number;
}
