import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsNumber, IsOptional, IsString } from 'class-validator';

// DTO de entrada para crear una zona (POST /zone)
export class CreateZoneDto {
  // Oculto en Swagger: lo asigna el controller automáticamente desde el usuario autenticado
  @ApiHideProperty()
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  id_user?: number;

  // Identificador de zona (letras y/o números, ej. "1", "10", "A2"), único requisito obligatorio para crearla
  @ApiProperty({ example: '1' })
  @IsString()
  name: string;

  // Sede a la que pertenece; si se omite, el controller la autocompleta con la del token
  @ApiProperty({ example: '1' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  id_site?: number;

  // Subsede a la que pertenece; si se omite, el controller la autocompleta con la del token
  @ApiProperty({ example: '1' })
  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  id_subsite?: number;
}
