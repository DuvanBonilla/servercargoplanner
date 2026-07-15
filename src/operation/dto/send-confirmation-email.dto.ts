import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator';

export class SendConfirmationEmailDto {
  @ApiProperty({
    description:
      'Correo destino al que se enviara el enlace de confirmacion. ' +
      'Por ahora se escribe manualmente (aun no se obtiene de la base de datos).',
    example: 'cliente@empresa.com',
  })
  @IsEmail({}, { message: 'Debe proporcionar un correo destino valido' })
  to!: string;

  @ApiPropertyOptional({
    description: 'Asunto del correo. Si se omite se usa uno por defecto.',
    example: 'Confirmacion de operacion #1871',
  })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  subject?: string;

  @ApiPropertyOptional({
    description:
      'Cuerpo de contexto del correo (texto plano, admite saltos de linea). ' +
      'El enlace al portal se agrega automaticamente debajo del mensaje.',
    example:
      'Hola, le compartimos el enlace para confirmar o rechazar la operacion.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  body?: string;
}
