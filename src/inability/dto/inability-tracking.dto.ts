import { ApiProperty, OmitType } from '@nestjs/swagger';
import { InabilityFollowUpType, InabilityRecoveryStatus } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, MaxLength, Min } from 'class-validator';
import { RegisterInabilityDto } from './register-inability.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

/** DATA_CHANGE lo escribe el sistema al editar los datos; no se registra a mano */
export const MANUAL_FOLLOW_UP_TYPES = ['FILING', 'PQR', 'PAYMENT', 'REJECTION', 'NOTE'] as const;

export class UpdateInabilityDetailsDto extends OmitType(RegisterInabilityDto, [
  'fileToken',
  'id_worker',
  'documentConfirmed',
] as const) {
  @ApiProperty({ required: false, example: 450000, description: 'Amount approved by the EPS/ARL in its settlement, in pesos' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'approvedAmount must be a value in pesos with at most 2 decimals' })
  @Min(0, { message: 'approvedAmount cannot be negative' })
  approvedAmount?: number;
}

export class CreateInabilityFollowUpDto {
  @ApiProperty({ enum: MANUAL_FOLLOW_UP_TYPES, example: 'FILING' })
  @IsIn(MANUAL_FOLLOW_UP_TYPES, { message: `type must be one of the following: ${MANUAL_FOLLOW_UP_TYPES.join(', ')}` })
  type: Exclude<InabilityFollowUpType, 'DATA_CHANGE'>;

  @ApiProperty({ example: '2026-10-25', description: 'Date of the event (YYYY-MM-DD). Cannot be in the future or before the inability start' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'eventDate must have the format YYYY-MM-DD' })
  eventDate: string;

  @ApiProperty({ required: false, example: '123456789', description: 'FILING: filing number (required). It changes if the entity rejects and it is filed again' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  filingNumber?: string;

  @ApiProperty({ required: false, example: '987654', description: 'Settlement number (NAIL) given by the EPS/ARL' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  nail?: string;

  @ApiProperty({ required: false, example: 'PQR-2026-001', description: 'PQR: number given by the entity (this or description is required)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  pqrNumber?: string;

  @ApiProperty({ required: false, example: 450000, description: 'PAYMENT: amount paid to the company, in pesos (required)' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'amount must be a value in pesos with at most 2 decimals' })
  @Min(0.01, { message: 'amount must be greater than 0' })
  amount?: number;

  @ApiProperty({ required: false, example: 3, description: 'PAYMENT: days covered by the payment (required)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'days must be an integer' })
  @Min(1, { message: 'days must be greater than 0' })
  days?: number;

  @ApiProperty({ required: false, example: 'Se solicita respuesta por correo', description: 'Required for REJECTION and NOTE' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(1000)
  description?: string;

  @ApiProperty({
    enum: InabilityRecoveryStatus,
    required: false,
    example: InabilityRecoveryStatus.PAID,
    description:
      'NOTE: optional status change. The other types set it: FILING = FILED, PQR = IN_RECOVERY, REJECTION = REJECTED, ' +
      'PAYMENT = PAID when the paid days cover the days owed by the entity and the paid amount covers the approved amount, otherwise PARTIALLY_PAID',
  })
  @IsOptional()
  @IsEnum(InabilityRecoveryStatus, {
    message: `recoveryStatus must be one of the following: ${Object.values(InabilityRecoveryStatus).join(', ')}`,
  })
  recoveryStatus?: InabilityRecoveryStatus;
}
