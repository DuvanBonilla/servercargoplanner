import { ApiProperty } from '@nestjs/swagger';
import { StatusActivation } from '@prisma/client';
import { IsEnum } from 'class-validator';

export class UpdateClientEmailStatusDto {

  @ApiProperty({
    enum: StatusActivation,
  })
  @IsEnum(StatusActivation)
  status!: StatusActivation;

}