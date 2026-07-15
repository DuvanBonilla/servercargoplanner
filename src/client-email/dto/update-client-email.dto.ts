import { ApiPropertyOptional } from '@nestjs/swagger';
import { ClientEmailType, StatusActivation } from '@prisma/client';
import {
  IsEmail,
  IsEnum,
  IsOptional,
  IsString,
} from 'class-validator';

export class UpdateClientEmailDto {
  @ApiPropertyOptional({
    example: 'liquidacion@cliente.com',
    description: 'Correo electrónico',
  })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({
    enum: ClientEmailType,
    enumName: 'ClientEmailType',
    description: 'Tipo de correo',
  })
  @IsOptional()
  @IsEnum(ClientEmailType)
  type?: ClientEmailType;

  @ApiPropertyOptional({
    example: 'Área de Liquidación',
    description: 'Nombre o descripción del correo',
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    enum: StatusActivation,
    enumName: 'StatusActivation',
    description: 'Estado del correo',
  })
  @IsOptional()
  @IsEnum(StatusActivation)
  status?: StatusActivation;
}