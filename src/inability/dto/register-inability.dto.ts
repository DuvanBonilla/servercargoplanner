import { ApiProperty, PickType } from '@nestjs/swagger';
import { InabilityOrigin, TypeDisability } from '@prisma/client';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
/** CIE-10: letra + 2 dígitos + opcional 1 carácter (ej. M545, S934, J00X) */
const CIE10 = /^[A-Z]\d{2}[0-9A-Z]?$/;
const trimUpper = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toUpperCase().replace(/[\s.]/g, '') || undefined : value;
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

export class SaveCertificateDraftDto {
  @ApiProperty({
    example: { startDate: '2026-10-01', endDate: '2026-10-05', ibc: '1750905' },
    description: 'Registration form as the user left it',
  })
  @IsObject({ message: 'form must be an object' })
  form: Record<string, unknown>;

  @ApiProperty({ example: 479, required: false, description: 'Worker selected in the form, when it was corrected from the certificate' })
  @IsOptional()
  @IsInt()
  selectedWorkerId?: number;
}

export class RegisterInabilityDto {
  @ApiProperty({
    example: '3f1c2b7a-8d4e-4b1a-9c3e-2a6f5d7e8b90',
    description: 'fileToken returned by POST /inability/certificate/extract (valid for 7 days)',
  })
  @IsUUID('4', { message: 'fileToken must be a valid token' })
  fileToken: string;

  @ApiProperty({ example: 479, description: 'Worker id. Must match the document number read from the certificate' })
  @Type(() => Number)
  @IsInt({ message: 'id_worker must be an integer' })
  id_worker: number;

  @ApiProperty({ example: '2026-10-20', description: 'Start date (YYYY-MM-DD)' })
  @Matches(DATE_ONLY, { message: 'startDate must have the format YYYY-MM-DD' })
  startDate: string;

  @ApiProperty({ example: '2026-10-24', description: 'End date (YYYY-MM-DD)' })
  @Matches(DATE_ONLY, { message: 'endDate must have the format YYYY-MM-DD' })
  endDate: string;

  @ApiProperty({ enum: InabilityOrigin, example: InabilityOrigin.GENERAL })
  @IsEnum(InabilityOrigin, {
    message: `origin must be one of the following: ${Object.values(InabilityOrigin).join(', ')}`,
  })
  origin: InabilityOrigin;

  @ApiProperty({
    enum: TypeDisability,
    required: false,
    example: TypeDisability.INITIAL,
    description:
      'Classification confirmed by the user. If omitted, the one suggested from the worker history is used (see POST /inability/register/preview)',
  })
  @IsOptional()
  @IsEnum(TypeDisability, {
    message: `classification must be one of the following: ${Object.values(TypeDisability).join(', ')}`,
  })
  classification?: TypeDisability;

  @ApiProperty({
    required: false,
    example: 310,
    description: 'EXTENSION only: previous inability being extended. If omitted, the suggested one is used',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'id_extension_of must be an integer' })
  id_extension_of?: number;

  @ApiProperty({
    required: false,
    example: '2026-09-20',
    description: 'EXTENSION whose previous inability is not in the system: start date of the INITIAL inability (YYYY-MM-DD). Sent together with externalChainDays',
  })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'externalChainStart must have the format YYYY-MM-DD' })
  externalChainStart?: string;

  @ApiProperty({
    required: false,
    example: 12,
    description: 'EXTENSION whose previous inability is not in the system: days accumulated in the chain before this inability',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'externalChainDays must be an integer' })
  @Min(1, { message: 'externalChainDays must be greater than 0' })
  externalChainDays?: number;

  @ApiProperty({ example: 'M545', description: 'Principal diagnosis (CIE-10)' })
  @Transform(trimUpper)
  @Matches(CIE10, { message: 'diagnosisPrincipal must be a valid CIE-10 code (e.g. M545)' })
  diagnosisPrincipal: string;

  @ApiProperty({
    required: false,
    type: [String],
    example: ['S400', 'F431'],
    description: 'Every related diagnosis printed on the certificate (CIE-10). The extension is detected by any of them',
  })
  @IsOptional()
  @Transform(({ value }) =>
    Array.isArray(value)
      ? [...new Set(value.map((code) => trimUpper({ value: code })).filter((code) => typeof code === 'string'))]
      : value,
  )
  @IsArray({ message: 'diagnosesRelated must be a list of CIE-10 codes' })
  @ArrayMaxSize(20, { message: 'diagnosesRelated can have at most 20 codes' })
  @Matches(CIE10, { each: true, message: 'each related diagnosis must be a valid CIE-10 code (e.g. M511)' })
  diagnosesRelated?: string[];

  @ApiProperty({
    example: 1750905,
    description: 'Monthly IBC in pesos, entered by the user from payroll. Cannot be lower than the minimum wage of the start year',
  })
  @Type(() => Number)
  @IsInt({ message: 'ibc must be an integer value in pesos' })
  @Min(1, { message: 'ibc must be greater than 0' })
  ibc: number;

  @ApiProperty({
    example: true,
    description: 'IPS belongs to the EPS network: 30 days to file the inability; otherwise 15 days (counted from the start date)',
  })
  @IsBoolean({ message: 'ipsInNetwork must be true or false' })
  ipsInNetwork: boolean;

  @ApiProperty({
    required: false,
    example: 3,
    description: 'Issuing EPS (catalog). Required for GENERAL, MATERNITY and PATERNITY. The ARL is taken from the company of the contract',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'id_eps must be an integer' })
  id_eps?: number;

  @ApiProperty({ required: false, example: '0012345678', description: 'Certificate number' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  certificateNumber?: string;

  @ApiProperty({ required: false, example: '987654', description: 'Authorization number (Nueva EPS "No. de")' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  authorizationNumber?: string;

  @ApiProperty({ required: false, example: '123456789', description: 'EPS/ARL filing number (radicado)' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  entityFilingNumber?: string;

  @ApiProperty({ required: false, example: '2026-10-20', description: 'Issue date (YYYY-MM-DD)' })
  @IsOptional()
  @Matches(DATE_ONLY, { message: 'issueDate must have the format YYYY-MM-DD' })
  issueDate?: string;

  @ApiProperty({ required: false, example: 'IPS EJEMPLO SAS' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  ipsName?: string;

  @ApiProperty({ required: false, example: '470010000001' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(60)
  ipsCode?: string;

  @ApiProperty({ required: false, example: 'NOMBRE DEL MEDICO' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(200)
  professionalName?: string;

  @ApiProperty({
    required: false,
    example: false,
    description:
      'Only when the document number could not be read from the certificate (NOT_READ): the user confirms it belongs to the worker. ' +
      'A document number that differs from the worker is always rejected',
  })
  @IsOptional()
  @IsBoolean({ message: 'documentConfirmed must be true or false' })
  documentConfirmed?: boolean;

  @ApiProperty({ required: false, example: 'Recibida por WhatsApp' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  observation?: string;
}

/** Datos mínimos para calcular clasificación, pagador y plazos antes de guardar */
export class PreviewInabilityDto extends PickType(RegisterInabilityDto, [
  'id_worker',
  'startDate',
  'endDate',
  'origin',
  'classification',
  'id_extension_of',
  'externalChainStart',
  'externalChainDays',
  'diagnosesRelated',
] as const) {
  @ApiProperty({ required: false, example: 310, description: 'When editing: inability being edited, left out of the worker history' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'id_inability must be an integer' })
  id_inability?: number;

  @ApiProperty({ required: false, example: 'M545', description: 'Principal diagnosis (CIE-10); without it the extension cannot be detected' })
  @IsOptional()
  @Transform(trimUpper)
  @Matches(CIE10, { message: 'diagnosisPrincipal must be a valid CIE-10 code (e.g. M545)' })
  diagnosisPrincipal?: string;

  @ApiProperty({ required: false, example: 1750905, description: 'Monthly IBC (validated against the minimum wage if sent)' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'ibc must be an integer value in pesos' })
  ibc?: number;

  @ApiProperty({ required: false, example: true, description: 'IPS belongs to the EPS network (filing deadline)' })
  @IsOptional()
  @IsBoolean({ message: 'ipsInNetwork must be true or false' })
  ipsInNetwork?: boolean;
}
