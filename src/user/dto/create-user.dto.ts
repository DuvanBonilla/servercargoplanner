import { IsArray, IsEnum, IsInt, IsNumber, IsOptional, IsString } from 'class-validator';
import { Role } from '@prisma/client';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ example: 'John Doe' })
  @IsString()
  name: string;

  @ApiProperty({ example: 'john' })
  @IsString()
  username: string;

  @ApiProperty({ example: '000-000-000' })
  @IsString()
  dni: string;

  @ApiProperty({ example: '3222###' })
  @IsString()
  phone: string;

  @ApiProperty({ example: '******' })
  @IsString()
  password: string;

  @ApiProperty({ example: 'Developer' })
  @IsString()
  occupation: string;

  @ApiProperty({ example: `${Object.values(Role).join(', ')}` })
  @IsEnum(Role,{
    message: `role debe ser uno de los siguientes valores: ${Object.values(Role).join(', ')}`
  })
  @Transform(({ value }) => value.toUpperCase())
  role: Role;

  @ApiProperty({ example: '1' })
  @IsNumber()
  @Transform(({ value }) => Number(value))
  @IsOptional()
  id_site?: number;

  @ApiProperty({ example: '1' })
  @IsNumber()
  @Transform(({ value }) => Number(value))
  @IsOptional()
  id_subsite?: number;

  @ApiProperty({ example: [1, 2], required: false })
  @IsArray()
  @IsInt({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((v) => Number(v)) : value,
  )
  @IsOptional()
  id_subsites?: number[];

  @ApiProperty({ example: [1, 2], required: false })
  @IsArray()
  @IsInt({ each: true })
  @Transform(({ value }) =>
    Array.isArray(value) ? value.map((v) => Number(v)) : value,
  )
  @IsOptional()
  id_areas?: number[];
}
