import { ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class ResubmitOperationDto {
  @ApiProperty({
    description: 'Nota interna del supervisor sobre el motivo del reenvío (obligatoria cuando se reenvía sin modificaciones)',
    required: false,
    example: 'El rechazo del cliente no tiene justificación válida según contrato',
  })
  @IsOptional()
  @IsString()
  supervisorObservation?: string;
}
