import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

// Convierte strings vacíos/espacios en undefined, para no filtrar por un search inútil
const trimOrUndefined = (value: unknown) => {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized || undefined;
};

// DTO de entrada para exportar zonas a Excel (POST /zone/export)
export class ExportZoneDto {
  @ApiPropertyOptional({
    example: 'norte',
    description: 'Filtro opcional por nombre de zona',
  })
  @IsOptional()
  @IsString()
  @Transform(({ value }) => trimOrUndefined(value))
  search?: string;
}
