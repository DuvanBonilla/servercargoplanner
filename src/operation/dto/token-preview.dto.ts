import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class TokenPreviewDto {
  @ApiProperty({
    description: 'Token de confirmacion de la operacion especial',
    example: 'f72a7c54b9a5241f57f7e13239a25d33a2e95b8b17c0687c',
  })
  @IsString()
  token!: string;
}
