import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { FeedingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class FeedingAddedToServiceItemDto {
  @ApiProperty({
    example: 'BREAKFAST',
    description: `Tipo de alimentación. Valores válidos: ${Object.values(FeedingStatus).join(', ')}`,
  })
  @IsEnum(FeedingStatus, {
    message: `type debe ser uno de los siguientes valores: ${Object.values(FeedingStatus).join(', ')}`,
  })
  type!: FeedingStatus;

  @ApiProperty({
    example: 1,
    required: false,
    description:
      'Cantidad de alimentaciones de este tipo a registrar para el grupo (ej. 2 almuerzos extra). Por defecto 1',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @IsOptional()
  quantity?: number;
}

export class CreateFeedingAddedToServiceDto {
  @ApiProperty({ example: 12 })
  @Type(() => Number)
  @IsNumber()
  id_operation!: number;

  @ApiProperty({
    example: 3,
    description: 'Código del grupo (OperationGroup.code) al que se adhiere la alimentación',
  })
  @Type(() => Number)
  @IsNumber()
  code_group!: number;

  @ApiProperty({ example: '2025-09-01 12:06', required: false })
  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, {
    message: 'dateFeeding debe tener formato YYYY-MM-DD HH:MM',
  })
  dateFeeding?: string;

  @ApiProperty({
    type: [FeedingAddedToServiceItemDto],
    description:
      'Uno o más tipos de alimentación a registrar para el grupo, cada uno con su cantidad. Ej: [{ "type": "LUNCH", "quantity": 2 }, { "type": "BREAKFAST", "quantity": 1 }]',
    example: [
      { type: 'LUNCH', quantity: 2 },
      { type: 'BREAKFAST', quantity: 1 },
    ],
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'items debe contener al menos 1 elemento' })
  @ArrayMaxSize(20, { message: 'items no puede superar los 20 elementos por petición' })
  @ValidateNested({ each: true })
  @Type(() => FeedingAddedToServiceItemDto)
  items!: FeedingAddedToServiceItemDto[];

  @ApiHideProperty()
  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  id_user?: number;
}
