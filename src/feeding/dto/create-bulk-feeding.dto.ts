import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { FeedingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
} from 'class-validator';

export class BulkFeedingItemDto {
  @ApiProperty({ example: 128 })
  @Type(() => Number)
  @IsNumber()
  id_worker!: number;

  @ApiProperty({ example: `${Object.values(FeedingStatus).join(', ')}` })
  @IsEnum(FeedingStatus, {
    message: `type debe ser uno de: ${Object.values(FeedingStatus).join(', ')}`,
  })
  type!: FeedingStatus;

  @ApiProperty({ example: '2025-09-01 12:06', required: false })
  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, {
    message: 'dateFeeding debe tener formato YYYY-MM-DD HH:MM',
  })
  dateFeeding?: string;

  @ApiProperty({ example: false, required: false })
  @IsBoolean()
  @IsOptional()
  forceMissingMeal?: boolean;
}

export class CreateBulkFeedingDto {
  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsNumber()
  id_operation!: number;

  @ApiProperty({ example: '2025-09-01 12:06', required: false, description: 'Fecha global para todos los ítems. Cada ítem puede sobreescribirla con su propio dateFeeding' })
  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, {
    message: 'dateFeeding debe tener formato YYYY-MM-DD HH:MM',
  })
  dateFeeding?: string;

  @ApiProperty({ type: [BulkFeedingItemDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'items debe contener al menos 1 elemento' })
  @ArrayMaxSize(500, { message: 'items no puede superar los 500 elementos por petición' })
  @ValidateNested({ each: true })
  @Type(() => BulkFeedingItemDto)
  items!: BulkFeedingItemDto[];

  @ApiProperty({ example: false, required: false, description: 'Si true, aborta toda la operación al primer error. Si false (default), registra los válidos e informa los fallidos' })
  @IsBoolean()
  @IsOptional()
  stopOnError?: boolean;

  @ApiHideProperty()
  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  id_user?: number;
}
