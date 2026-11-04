import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

// Un evento registrado en el teléfono (ej. fallo al crear una operación)
export class AppLogEntryDto {
  @IsIn(['info', 'warn', 'error'])
  level: 'info' | 'warn' | 'error';

  @IsString()
  @MaxLength(100)
  event: string;

  @IsString()
  @MaxLength(4000)
  message: string;

  // Mismo valor que el header X-Request-Id de la petición relacionada,
  // para cruzar el log del teléfono con la línea del RequestLoggerMiddleware
  @IsOptional()
  @IsString()
  @MaxLength(100)
  correlationId?: string;

  // Hora del teléfono cuando ocurrió (puede enviarse horas después si no había señal)
  @IsString()
  @MaxLength(40)
  deviceTime: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  appVersion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  device?: string;

  @IsOptional()
  @IsObject()
  data?: Record<string, unknown>;
}

export class CreateAppLogDto {
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => AppLogEntryDto)
  entries: AppLogEntryDto[];
}
