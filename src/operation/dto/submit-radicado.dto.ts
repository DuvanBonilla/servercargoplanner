import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class SubmitRadicadoDto {
  @ApiProperty({
    description: 'Token de liquidacion recibido por correo',
    example: 'f72a7c54b9a5241f57f7e13239a25d33a2e95b8b17c0687c',
  })
  @IsString()
  token!: string;

  @ApiProperty({
    description: 'Numero de radicado alfanumerico asignado al servicio',
    example: 'RAD-2026-00123',
  })
  @IsString()
  @MinLength(1)
  fileCode!: string;
}
