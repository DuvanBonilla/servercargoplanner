import { ApiProperty } from '@nestjs/swagger';

class ExtractedFieldEntity {
  @ApiProperty({ example: 'J069', nullable: true })
  value: unknown;

  @ApiProperty({ enum: ['high', 'medium', 'low'], example: 'high', description: 'Highlight medium/low fields for review' })
  confidence: 'high' | 'medium' | 'low';
}

class ExtractionEntity {
  @ApiProperty({ example: 'NUEVA_EPS', description: 'Detected certificate format (NUEVA_EPS, SURA, MUTUALSER, AI_EPS, AI_ARL, UNKNOWN)' })
  format: string;

  @ApiProperty({ enum: ['text', 'ocr'], example: 'ocr', description: 'text = PDF with text layer, ocr = scanned image' })
  source: 'text' | 'ocr';

  @ApiProperty({ enum: ['local', 'openai'], example: 'openai', description: 'local = text layer/local OCR, openai = AI vision model' })
  engine: 'local' | 'openai';

  @ApiProperty({ example: 1, nullable: true })
  page: number | null;

  @ApiProperty({ example: { type: 'EPS', name: 'NUEVA EPS S.A.', nit: '900156264-2' } })
  entity: { type: 'EPS' | 'ARL' | 'UNKNOWN'; name: string | null; nit: string | null };

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      properties: {
        value: { nullable: true, description: 'Value read (string, number or boolean)' },
        confidence: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Highlight medium/low fields for review' },
      },
    },
    example: {
      certificateNumber: { value: '0000000001', confidence: 'high' },
      authorizationNumber: { value: '1000001', confidence: 'high' },
      workerDocumentNumber: { value: '1000000001', confidence: 'high' },
      startDate: { value: '2026-01-10', confidence: 'high' },
      endDate: { value: '2026-01-12', confidence: 'high' },
      days: { value: 3, confidence: 'high' },
      diagnosisPrincipal: { value: 'J069', confidence: 'medium' },
      origin: { value: 'GENERAL', confidence: 'high' },
      classification: { value: 'INITIAL', confidence: 'high' },
    },
    description:
      'Fields read from the certificate. Possible keys: certificateNumber, authorizationNumber, entityFilingNumber, issueDate, receptionDate, ' +
      'workerDocumentType, workerDocumentNumber, workerName, employerNit, employerName, ipsCode, ipsName, days, startDate, endDate, ' +
      'classification, diagnosisPrincipal, diagnosesRelated (list), origin, attentionType (OUTPATIENT = ambulatoria, INPATIENT = hospitalaria), ' +
      'generationType (GENERATION, TRANSCRIPTION), serviceModality, retroactive, professionalDocument, professionalName, medicalRegistry, ' +
      'professionalSpecialty. Literal printed text (audit): contingencyText, presumedOriginText, attentionCauseText, extensionText, ' +
      'certificateStatus, filingDate, issuePlace. Entity liquidation (recovery): ibc, entityPaidDays, paymentPercentage, subsidyValue, ' +
      'adjustmentValue, approvedTotal. Normalized codes: classification INITIAL = Inicial, EXTENSION = Prorroga (as printed on the ' +
      'certificate; the system recalculates it from the worker history); origin GENERAL = origen general/comun (enfermedad general, ' +
      'accidente de transito), LABOR = origen laboral, MATERNITY = licencia de maternidad, PATERNITY = licencia de paternidad.',
  })
  fields: Record<string, ExtractedFieldEntity>;

  @ApiProperty({
    type: [String],
    example: ['DAYS_MISMATCH: 4 days on the certificate but the dates cover 3 days'],
    description:
      'Checks to review: WORKER_MISMATCH, EMPLOYER_MISMATCH, DATES_INVERTED, DAYS_MISMATCH, DAYS_INFERRED, DIAGNOSIS_MISSING, FIELDS_MISSING, ' +
      'FORMAT_UNKNOWN, LOW_RESOLUTION, DATE_OUT_OF_RANGE, AI_NO_CREDITS, AI_INVALID_KEY, AI_UNAVAILABLE',
  })
  warnings: string[];

  @ApiProperty({ example: 1 })
  pagesRead: number;

  @ApiProperty({ example: 7200, description: 'Extraction time in milliseconds' })
  elapsedMs: number;

  @ApiProperty({
    nullable: true,
    example: { provider: 'openai', model: 'gpt-6-luna', inputTokens: 1500, outputTokens: 300, totalTokens: 1800, costUsd: 0.0003 },
    description: 'AI consumption of this extraction (null when no AI was used); it is stored in the AI usage log',
  })
  usage: { provider: string; model: string; inputTokens: number; outputTokens: number; totalTokens: number; costUsd: number } | null;
}

export class CertificateExtractionEntity {
  @ApiProperty({
    example: '3f1c2b7a-8d4e-4b1a-9c3e-2a6f5d7e8b90',
    description:
      'Token of the uploaded certificate kept on the server for 7 days. Send it to POST /inability/register: ' +
      'the file is stored with the inability and the document number is checked against this reading',
  })
  fileToken: string;

  @ApiProperty({ nullable: true, example: { id: 1, name: 'NOMBRE DE EJEMPLO', dni: '1000000001' } })
  worker: { id: number; name: string; dni: string } | null;

  @ApiProperty({
    example: {
      status: 'MISMATCH',
      canRegister: false,
      selectedWorker: { id: 1, name: 'NOMBRE SELECCIONADO', dni: '1000000001' },
      certificateDocument: '1000000002',
      certificateName: 'NOMBRE DEL CERTIFICADO',
      suggestedWorker: { id: 2, name: 'NOMBRE DEL CERTIFICADO', dni: '1000000002', status: 'AVALIABLE' },
      suggestedWorkerOtherSite: false,
    },
    description:
      'Document check against the selected worker. status: MATCH | MISMATCH | NOT_READ | NO_WORKER_SELECTED. ' +
      'The inability can only be registered to the selected worker when status is MATCH (canRegister). ' +
      'When the certificate belongs to another worker of the same site, suggestedWorker is returned to correct the selection; ' +
      'suggestedWorkerOtherSite = true when it belongs to a worker of another site (no data exposed).',
  })
  workerCheck: {
    status: 'MATCH' | 'MISMATCH' | 'NOT_READ' | 'NO_WORKER_SELECTED';
    canRegister: boolean;
    selectedWorker: { id: number; name: string; dni: string } | null;
    certificateDocument: string | null;
    certificateName: string | null;
    suggestedWorker: { id: number; name: string; dni: string; status: string } | null;
    suggestedWorkerOtherSite: boolean;
  };

  @ApiProperty({
    nullable: true,
    example: { id: 12, company: { id: 2, name: 'CARGOBAN OPERADOR Y LOGISTICO SAS', nit: '900502659' } },
    description: 'Contract of the worker in effect today (its company NIT is checked against the certificate)',
  })
  currentContract: { id: number; company: { id: number; name: string; nit: string } | null } | null;

  @ApiProperty({
    example: { eps: { id: 1, name: 'NUEVA EPS S.A.', status: 'ACTIVE' }, arl: null },
    description: 'EPS/ARL of the catalog whose NIT matches the certificate entity (null if not registered)',
  })
  catalogMatch: { eps: { id: number; name: string; status: string } | null; arl: { id: number; name: string; status: string } | null };

  @ApiProperty({ type: ExtractionEntity })
  extraction: ExtractionEntity;
}

export { ExtractedFieldEntity };
