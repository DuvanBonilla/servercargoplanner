import { ApiHideProperty, ApiProperty } from "@nestjs/swagger";
import { CauseDisability, TypeDisability } from "@prisma/client"
import { Type, Transform } from "class-transformer";
import { IsEnum, IsNumber, IsOptional, IsString, Matches, IsDate } from "class-validator"


export class CreateInabilityDto {
    @ApiProperty({ example: '2021-09-01' })
    @Transform(({ value }) => {
      if (value instanceof Date) return value;
      if (typeof value === 'string') return new Date(value);
      return value;
    })
    @IsDate()
    dateDisableStart: Date;
  
    @ApiProperty({ example: '2021-10-01' })
    @Transform(({ value }) => {
      if (value instanceof Date) return value;
      if (typeof value === 'string') return new Date(value);
      return value;
    })
    @IsDate()
    dateDisableEnd: Date;

    @ApiProperty({example:`${Object.values(TypeDisability).join(', ')}` })
    @IsEnum(TypeDisability, {
      message: `type debe ser uno de los siguientes valores: ${Object.values(TypeDisability).join(', ')}`,}) 
    type: TypeDisability

    @ApiProperty({example:`${Object.values(CauseDisability).join(', ')}` })
    @IsEnum(CauseDisability, {
      message: `cause debe ser uno de los siguientes valores: ${Object.values(CauseDisability).join(', ')}`,})
    cause:CauseDisability

    @ApiProperty({ example: '128' })
    @Type(() => Number)
    @IsNumber()
    id_worker: number

    @ApiHideProperty()
    @Type(() => Number)
    @IsNumber()
    @IsOptional()
    id_user: number
}
