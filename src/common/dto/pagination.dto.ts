import { IsOptional, IsString, IsInt, Min, Max } from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class PaginationQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string; // Cursor para paginación basada en cursor

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number = 10; // Límite por defecto de 10 registros, máximo 500 para grandes datasets

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number; // Para paginación tradicional (offset)
}

export class PaginationMetaDto {
  totalItems: number;
  itemsPerPage: number;
  currentPage: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
  nextCursor?: string | null;
  prevCursor?: string | null;
}

export class PaginatedResponseDto<T> {
  data: T[];
  meta: PaginationMetaDto;
}

// Utilidades para encoding/decoding de cursor
export function encodeCursor(value: any): string {
  return Buffer.from(JSON.stringify(value)).toString('base64');
}

export function decodeCursor(cursor: string): any {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64').toString());
  } catch {
    return null;
  }
}