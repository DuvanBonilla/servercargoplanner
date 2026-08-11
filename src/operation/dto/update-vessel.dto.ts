import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class UpdateVesselDto {
  @ApiProperty({
    example: 'MSC ANNA',
    description: 'Nombre de la embarcación (motorShip) asociada a la operación. Envía un string vacío para limpiarlo.',
    maxLength: 150,
  })
  @IsString()
  @MaxLength(150)
  motorShip!: string;
}
