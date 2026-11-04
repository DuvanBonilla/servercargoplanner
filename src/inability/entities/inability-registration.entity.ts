import { ApiProperty } from '@nestjs/swagger';

const SUMMARY_EXAMPLE = {
  id: 310,
  startDate: '2026-10-10',
  endDate: '2026-10-14',
  days: 5,
  diagnosisPrincipal: 'M545',
  diagnosesRelated: [],
  id_extension_of: null,
};

export class InabilityPreviewEntity {
  @ApiProperty({ example: { id: 1, name: 'NOMBRE DE EJEMPLO', dni: '1000000001' } })
  worker: { id: number; name: string; dni: string };

  @ApiProperty({ example: '2026-10-20' })
  startDate: string;

  @ApiProperty({ example: '2026-10-24' })
  endDate: string;

  @ApiProperty({ example: 5, description: 'Days between startDate and endDate (inclusive)' })
  days: number;

  @ApiProperty({
    nullable: true,
    example: {
      id: 12,
      contractType: 'FIXED_3_MONTHS',
      workerType: 'OPERATIVE',
      startDate: '2026-09-01',
      endDate: '2026-11-30',
      continuousStartDate: '2026-03-01',
    },
    description:
      'Contract in force on the start date (null if none). continuousStartDate = start of the chain of continuous renewals with the same company',
  })
  contract: Record<string, unknown> | null;

  @ApiProperty({
    nullable: true,
    example: 233,
    description: 'Contract days completed on the start date, counted from continuousStartDate. Under 28: the company pays all days',
  })
  contractDays: number | null;

  @ApiProperty({ nullable: true, example: { id: 2, name: 'EMPRESA DE EJEMPLO SAS', nit: '900000001' } })
  company: { id: number; name: string; nit: string } | null;

  @ApiProperty({ nullable: true, example: { id: 1, name: 'ARL DE EJEMPLO', nit: '860000001' } })
  arl: { id: number; name: string; nit: string } | null;

  @ApiProperty({
    example: {
      classification: 'EXTENSION',
      reason: 'SAME_DIAGNOSIS_WITHIN_30_DAYS',
      previous: SUMMARY_EXAMPLE,
      gapDays: 6,
      sharedDiagnosis: 'M545',
      maxGapDays: 30,
    },
    description:
      'Classification suggested from the worker history (not from the certificate). EXTENSION when a previous inability has the exact same ' +
      'CIE-10 code (principal or related) and no more than 30 days between its end and the new start, within the same company. ' +
      'reason: SAME_DIAGNOSIS_WITHIN_30_DAYS | NO_PREVIOUS_WITH_SAME_DIAGNOSIS_WITHIN_30_DAYS | NO_DIAGNOSIS',
  })
  suggestion: Record<string, unknown>;

  @ApiProperty({ example: 'EXTENSION', description: 'Classification applied (confirmed by the user or the suggested one)' })
  classification: 'INITIAL' | 'EXTENSION';

  @ApiProperty({ nullable: true, example: SUMMARY_EXAMPLE, description: 'Previous inability being extended' })
  extensionOf: Record<string, unknown> | null;

  @ApiProperty({
    example: { rootId: 310, rootStartDate: '2026-10-10', inabilities: 1, externalDays: 0, daysBefore: 5, totalDays: 10 },
    description:
      'Extension chain: first (INITIAL) inability, days accumulated before this one and total. externalDays = accumulated days entered by the user because the start of the chain is not in the system',
  })
  chain: Record<string, unknown>;

  @ApiProperty({
    example: {
      entity: 'EPS',
      companyDays: 2,
      entityDays: 3,
      pensionFundDays: 0,
      segments: [
        { from: '2026-10-20', to: '2026-10-21', days: 2, chainDayFrom: 6, chainDayTo: 7, payer: 'COMPANY', reason: 'EXTENSION_WITHIN_30_DAYS' },
        { from: '2026-10-22', to: '2026-10-24', days: 3, chainDayFrom: 8, chainDayTo: 10, payer: 'EPS', reason: 'ENTITY' },
      ],
    },
    description:
      'Who pays each day. payer: COMPANY | EPS | ARL | PENSION_FUND. reason: CONTRACT_UNDER_28_DAYS (company pays everything), ' +
      'COMPANY_FIRST_DAYS (INITIAL: general origin 2 days, labor 1), EXTENSION_WITHIN_30_DAYS (extension starting within 30 days of the INITIAL start: ' +
      'the company pays the first days again), LICENSE (maternity/paternity: EPS), ENTITY, PENSION_FUND_181_540 (general origin, chain days 181 to 540), OVER_540_DAYS',
  })
  payment: Record<string, unknown>;

  @ApiProperty({ nullable: true, example: { year: 2026, value: 1750905, dailyValue: 58363.5 } })
  minimumWage: { year: number; value: number; dailyValue: number } | null;

  @ApiProperty({ nullable: true, example: 58363.5, description: 'IBC / 30' })
  dailyIbc: number | null;

  @ApiProperty({
    nullable: true,
    example: '2026-11-19',
    description: 'Filing deadline: start + 30 days (IPS in the EPS network) or + 15 days (not in network). Null if ipsInNetwork was not sent',
  })
  filingDeadline: string | null;

  @ApiProperty({ example: '2029-10-20', description: 'Recovery deadline: start + 3 years' })
  recoveryDeadline: string;

  @ApiProperty({ type: [Object], example: [], description: 'Inabilities of the worker whose dates overlap (registration is rejected)' })
  overlaps: Record<string, unknown>[];

  @ApiProperty({ type: [Object], example: [SUMMARY_EXAMPLE], description: 'Last 10 inabilities of the worker' })
  history: Record<string, unknown>[];

  @ApiProperty({
    type: [String],
    example: ['NO_CONTRACT: the worker has no contract on the start date; the 28-day rule cannot be applied'],
    description:
      'NO_CONTRACT, NO_ARL, OVERLAP, CLASSIFICATION_DIFFERS_FROM_SUGGESTION, MINIMUM_WAGE_NOT_CONFIGURED',
  })
  warnings: string[];
}

export class InabilityRegisteredEntity {
  @ApiProperty({
    example: {
      id: 98,
      id_worker: 1,
      dateDisableStart: '2026-10-20T00:00:00.000Z',
      dateDisableEnd: '2026-10-24T00:00:00.000Z',
      type: 'EXTENSION',
      cause: 'DISEASE',
      origin: 'GENERAL',
      days: 5,
      ibc: 1750905,
      companyDays: 2,
      entityDays: 3,
      documentPath: 'inability/2026/3f1c2b7a-8d4e-4b1a-9c3e-2a6f5d7e8b90.pdf',
    },
    description: 'Inability saved with the copy of contract, company, EPS, ARL, IBC and the full certificate reading',
  })
  inability: Record<string, unknown>;

  @ApiProperty({ type: InabilityPreviewEntity })
  calculation: InabilityPreviewEntity;
}
