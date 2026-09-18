import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { FeedingStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsNumber, IsOptional, IsString, Matches } from 'class-validator';

export class CreateFeedingDto {
  @ApiProperty({ example: '128' })
  @Type(() => Number)
  @IsNumber()
  id_worker: number;

  @ApiProperty({ example: '12' })
  @Type(() => Number)
  @IsNumber()
  id_operation: number;

  @ApiProperty({ example: '2025-09-01 12:06' })
  @IsString()
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/, {
    message: 'dateFeeding debe tener formato YYYY-MM-DD HH:MM',
  })
  dateFeeding: string;

  @ApiProperty({example:`${Object.values(FeedingStatus).join(', ')}` })
  @IsEnum(FeedingStatus, {
    message: `status debe ser uno de los siguientes valores: ${Object.values(FeedingStatus).join(', ')}`,})
  type: FeedingStatus;

  @ApiHideProperty()
  @IsNumber()
  @Type(() => Number)
  @IsOptional()
  id_user?: number;
}
