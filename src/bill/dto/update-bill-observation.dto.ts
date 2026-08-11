import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateBillObservationDto {
  @ApiProperty({
    example: 'El supervisor no quiso firmar el radicado',
    description: 'Observación de la factura (Bill) del grupo. Envía un string vacío para limpiarla.',
    maxLength: 500,
  })
  @IsString()
  @MaxLength(500)
  observation!: string;
}
