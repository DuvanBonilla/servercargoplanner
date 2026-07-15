import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ClientEmailType, StatusActivation } from '@prisma/client';
import { IsEmail, IsEnum, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateClientEmailDto {

  @ApiProperty({
    example: 12,
    description: 'ID del cliente',
  })
  @IsInt()
  id_client!: number;

  @ApiProperty({
    example: 'liquidacion@cliente.com',
    description: 'Correo electrónico',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    enum: ClientEmailType,
    enumName: 'ClientEmailType',
    example: ClientEmailType.LIQUIDATION,
    description: 'Tipo de correo',
  })
  @IsEnum(ClientEmailType)
  type!: ClientEmailType;

  @ApiPropertyOptional({
    example: 'Área de Liquidación',
    description: 'Nombre o descripción del correo',
  })
  @IsOptional()
  @IsString()
  name?: string;

   @ApiPropertyOptional({
    enum: StatusActivation,
  })
  @IsOptional()
  @IsEnum(StatusActivation)
  status?: StatusActivation;
}