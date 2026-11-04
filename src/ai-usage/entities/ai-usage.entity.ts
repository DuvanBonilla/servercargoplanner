import { ApiProperty } from '@nestjs/swagger';

class UsageTotals {
  @ApiProperty({ example: 120, description: 'Number of AI calls' })
  calls: number;

  @ApiProperty({ example: 180000 })
  inputTokens: number;

  @ApiProperty({ example: 36000 })
  outputTokens: number;

  @ApiProperty({ example: 216000 })
  totalTokens: number;

  @ApiProperty({ example: 0.036, description: 'Cost in USD' })
  costUsd: number;
}

class ModelUsage extends UsageTotals {
  @ApiProperty({ example: 10 })
  month: number;

  @ApiProperty({ example: 'gpt-6-luna' })
  model: string;
}

class MonthUsage extends UsageTotals {
  @ApiProperty({ example: 10, description: 'Month (1-12), Colombian time' })
  month: number;

  @ApiProperty({ type: [ModelUsage] })
  byModel: ModelUsage[];
}

export class AiUsageSummaryEntity {
  @ApiProperty({ example: 2026 })
  year: number;

  @ApiProperty({ example: 'USD' })
  currency: string;

  @ApiProperty({ type: [MonthUsage], description: 'Only months with usage' })
  months: MonthUsage[];

  @ApiProperty({ type: UsageTotals })
  total: UsageTotals;
}

export class AiUsageLogEntity {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 'openai' })
  provider: string;

  @ApiProperty({ example: 'gpt-6-luna' })
  model: string;

  @ApiProperty({ example: 'INABILITY_CERTIFICATE' })
  purpose: string;

  @ApiProperty({ example: 1500 })
  inputTokens: number;

  @ApiProperty({ example: 300 })
  outputTokens: number;

  @ApiProperty({ example: 1800 })
  totalTokens: number;

  @ApiProperty({ example: 0.0003 })
  costUsd: number;

  @ApiProperty({ example: { id: 36, name: 'NOMBRE DE EJEMPLO' } })
  user: { id: number; name: string };

  @ApiProperty({ example: { id: 1, name: 'NOMBRE DE EJEMPLO' }, nullable: true })
  worker: { id: number; name: string } | null;

  @ApiProperty({ example: '2026-10-28T15:00:00.000Z' })
  createdAt: Date;
}
