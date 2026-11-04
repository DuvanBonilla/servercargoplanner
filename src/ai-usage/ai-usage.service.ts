import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { DAY_MS, getColombianStartOfCalendarDay } from 'src/common/utils/dateColombia';

export interface AiUsageEntry {
  provider: string;
  model: string;
  purpose: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
  id_user: number;
  id_worker?: number | null;
}

export interface MonthRow {
  month: number;
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number;
}

const round6 = (value: number) => Math.round(value * 1_000_000) / 1_000_000;

/** Registro y consulta del consumo de modelos de IA (tokens y costo en USD). */
@Injectable()
export class AiUsageService {
  constructor(private readonly prisma: PrismaService) {}

  log(entry: AiUsageEntry) {
    return this.prisma.aiUsageLog.create({
      // createdAt explícito: instante UTC real (los resúmenes lo pasan a hora Colombia)
      data: { ...entry, id_worker: entry.id_worker ?? null, createdAt: new Date() },
    });
  }

  /** Gasto por mes (hora Colombia) de un año, con el detalle por modelo */
  async monthlySummary(year: number) {
    const rows = await this.prisma.$queryRaw<MonthRow[]>`
      SELECT EXTRACT(MONTH FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota'))::int AS month,
             model,
             COUNT(*)::int AS calls,
             SUM("inputTokens")::int AS "inputTokens",
             SUM("outputTokens")::int AS "outputTokens",
             SUM("totalTokens")::int AS "totalTokens",
             SUM("costUsd")::float AS "costUsd"
      FROM "AiUsageLog"
      WHERE EXTRACT(YEAR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'America/Bogota')) = ${year}
      GROUP BY 1, 2
      ORDER BY 1, 2`;

    const empty = () => ({ calls: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0, costUsd: 0 });
    const add = (target: ReturnType<typeof empty>, row: MonthRow) => {
      target.calls += row.calls;
      target.inputTokens += row.inputTokens;
      target.outputTokens += row.outputTokens;
      target.totalTokens += row.totalTokens;
      target.costUsd = round6(target.costUsd + row.costUsd);
    };

    const months = new Map<number, ReturnType<typeof empty> & { month: number; byModel: MonthRow[] }>();
    const total = empty();
    for (const row of rows) {
      const month = months.get(row.month) ?? { month: row.month, ...empty(), byModel: [] };
      add(month, row);
      month.byModel.push({ ...row, costUsd: round6(row.costUsd) });
      months.set(row.month, month);
      add(total, row);
    }
    return { year, currency: 'USD', months: [...months.values()], total };
  }

  /** Detalle de llamadas entre dos fechas (días completos en hora Colombia) */
  async findAll(from: string, to: string) {
    const rows = await this.prisma.aiUsageLog.findMany({
      where: {
        createdAt: {
          gte: getColombianStartOfCalendarDay(from),
          lt: new Date(getColombianStartOfCalendarDay(to).getTime() + DAY_MS),
        },
      },
      include: {
        user: { select: { id: true, name: true } },
        worker: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => ({ ...r, costUsd: Number(r.costUsd) }));
  }
}
