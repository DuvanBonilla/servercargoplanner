/**
 * Backfill one-off de los snapshots de facturación para las Bill/BillDetail que
 * existían antes de introducir BillTariffSnapshot y BillDetailSnapshot.
 *
 * Qué hace (cada paso solo toca lo que NO tiene snapshot, así que es idempotente y
 * se puede volver a correr sin riesgo):
 *   1. tariff : crea BillTariffSnapshot (is_backfilled = true) para cada Bill sin
 *               él, con la tarifa que tiene HOY el servicio de la Bill y las horas
 *               de la Bill como worked_*.
 *   2. worked : completa worked_* en los BillTariffSnapshot que los tengan en NULL,
 *               tomándolos de la Bill.
 *   3. detail : crea BillDetailSnapshot para cada BillDetail sin él, con los
 *               valores actuales del BillDetail y el nombre/DNI actual del trabajador.
 *
 * IMPORTANTE: son aproximaciones. Lo que realmente se usó al crear una Bill vieja no
 * quedó registrado en ningún lado; el snapshot congela lo que existe al correr este
 * script. Las Bill creadas con el código nuevo ya tienen su snapshot real y no se
 * tocan.
 *
 * Uso (desde la raíz del proyecto, con DATABASE_URL apuntando a la BD destino):
 *   npx ts-node prisma/scripts/backfill-bill-snapshots.ts --dry-run   # solo cuenta
 *   npx ts-node prisma/scripts/backfill-bill-snapshots.ts             # ejecuta
 *   npx ts-node prisma/scripts/backfill-bill-snapshots.ts --only=detail
 */
import { Prisma, PrismaClient, YES_NO } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;
type Step = 'tariff' | 'worked' | 'detail';

export interface BackfillOptions {
  dryRun?: boolean;
  only?: Step | null;
  batchSize?: number;
  log?: (message: string) => void;
}

export interface BackfillResult {
  tariffCreated: number;
  tariffUnresolvedBillIds: number[];
  workedFilled: number;
  detailCreated: number;
}

const WORKED_FIELDS = [
  'HOD', 'HON', 'HED', 'HEN', 'HFOD', 'HFON', 'HFED', 'HFEN',
  'FAC_HOD', 'FAC_HON', 'FAC_HED', 'FAC_HEN', 'FAC_HFOD', 'FAC_HFON', 'FAC_HFED', 'FAC_HFEN',
] as const;

const tariffInclude = {
  subTask: true,
  costCenter: true,
  unitOfMeasure: true,
  facturationUnit: true,
} as const;

function workedFromBill(bill: any) {
  const worked: Record<string, any> = {};
  for (const field of WORKED_FIELDS) {
    worked[`worked_${field}`] = bill[field] ?? null;
  }
  return worked;
}

function tariffToSnapshotRow(billId: number, bill: any, tariff: any) {
  return {
    id_bill: billId,
    id_tariff: tariff.id,
    code: tariff.code ?? null,
    id_subtask: tariff.id_subtask ?? null,
    subTaskName: tariff.subTask?.name ?? null,
    id_costCenter: tariff.id_costCenter ?? null,
    costCenterName: tariff.costCenter?.name ?? null,
    costCenterCode: tariff.costCenter?.code ?? null,
    id_unidOfMeasure: tariff.id_unidOfMeasure ?? null,
    unitOfMeasureName: tariff.unitOfMeasure?.name ?? null,
    id_facturation_unit: tariff.id_facturation_unit ?? null,
    facturationUnitName: tariff.facturationUnit?.name ?? null,
    paysheet_tariff: tariff.paysheet_tariff,
    facturation_tariff: tariff.facturation_tariff,
    full_tariff: tariff.full_tariff as YES_NO,
    compensatory: tariff.compensatory as YES_NO,
    isSpecial: (tariff.isSpecial ?? null) as YES_NO | null,
    alternative_paid_service: tariff.alternative_paid_service as YES_NO,
    group_tariff: tariff.group_tariff as YES_NO,
    settle_payment: tariff.settle_payment as YES_NO,
    status: tariff.status ?? null,
    agreed_hours: tariff.agreed_hours ?? null,
    OD: tariff.OD,
    ON: tariff.ON,
    ED: tariff.ED,
    EN: tariff.EN,
    FOD: tariff.FOD,
    FON: tariff.FON,
    FED: tariff.FED,
    FEN: tariff.FEN,
    FAC_OD: tariff.FAC_OD,
    FAC_ON: tariff.FAC_ON,
    FAC_ED: tariff.FAC_ED,
    FAC_EN: tariff.FAC_EN,
    FAC_FOD: tariff.FAC_FOD,
    FAC_FON: tariff.FAC_FON,
    FAC_FED: tariff.FAC_FED,
    FAC_FEN: tariff.FAC_FEN,
    ...workedFromBill(bill),
    is_backfilled: true,
  };
}

async function backfillTariffSnapshots(db: Db, opts: Required<Omit<BackfillOptions, 'only'>>) {
  const { dryRun, batchSize, log } = opts;
  let lastId = 0;
  let created = 0;
  const unresolved: number[] = [];

  for (;;) {
    const bills = await db.bill.findMany({
      where: { id: { gt: lastId }, tariffSnapshot: null },
      orderBy: { id: 'asc' },
      take: batchSize,
    });
    if (bills.length === 0) break;
    lastId = bills[bills.length - 1].id;

    // Tarifa de cada Bill: la del primer BillDetail que tenga un trabajador con tarifa.
    const details = await db.billDetail.findMany({
      where: {
        id_bill: { in: bills.map((b) => b.id) },
        operationWorker: { id_tariff: { not: null } },
      },
      distinct: ['id_bill'],
      orderBy: { id: 'asc' },
      select: {
        id_bill: true,
        operationWorker: { select: { tariff: { include: tariffInclude } } },
      },
    });
    const tariffByBill = new Map<number, any>();
    for (const d of details) {
      if (d.operationWorker?.tariff) tariffByBill.set(d.id_bill, d.operationWorker.tariff);
    }

    const rows: any[] = [];
    for (const bill of bills) {
      let tariff = tariffByBill.get(bill.id);

      // Respaldo: Bill sin BillDetail -> usar el trabajador del mismo grupo/operación.
      if (!tariff && bill.id_group) {
        const ow = await db.operation_Worker.findFirst({
          where: {
            id_operation: bill.id_operation,
            id_group: bill.id_group,
            id_tariff: { not: null },
          },
          select: { tariff: { include: tariffInclude } },
        });
        tariff = ow?.tariff;
      }

      if (!tariff) {
        unresolved.push(bill.id);
        continue;
      }
      rows.push(tariffToSnapshotRow(bill.id, bill, tariff));
    }

    if (rows.length > 0 && !dryRun) {
      await db.billTariffSnapshot.createMany({ data: rows, skipDuplicates: true });
    }
    created += rows.length;
    log(`[tariff] procesadas hasta Bill ${lastId} — ${created} snapshots${dryRun ? ' (simulado)' : ''}`);
  }

  return { created, unresolved };
}

async function backfillWorkedHours(db: Db, dryRun: boolean, log: (m: string) => void) {
  if (dryRun) {
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(
      `SELECT count(*)::int AS n FROM "BillTariffSnapshot" WHERE "worked_HOD" IS NULL`,
    );
    return rows[0].n;
  }

  const setClause = WORKED_FIELDS.map((f) => `"worked_${f}" = b."${f}"`).join(', ');
  const updated = await db.$executeRawUnsafe(
    `UPDATE "BillTariffSnapshot" s SET ${setClause}
       FROM "Bill" b
      WHERE b.id = s.id_bill AND s."worked_HOD" IS NULL AND b."HOD" IS NOT NULL`,
  );
  log(`[worked] ${updated} snapshots con horas trabajadas completadas`);
  return updated;
}

async function backfillDetailSnapshots(db: Db, opts: Required<Omit<BackfillOptions, 'only'>>) {
  const { dryRun, batchSize, log } = opts;
  let lastId = 0;
  let created = 0;

  for (;;) {
    const details = await db.billDetail.findMany({
      where: { id: { gt: lastId }, snapshot: null },
      orderBy: { id: 'asc' },
      take: batchSize,
      include: {
        operationWorker: { select: { worker: { select: { name: true, dni: true } } } },
      },
    });
    if (details.length === 0) break;
    lastId = details[details.length - 1].id;

    const rows = details.map((d) => ({
      id_bill_detail: d.id,
      id_bill: d.id_bill,
      id_operation_worker: d.id_operation_worker,
      workerName: d.operationWorker?.worker?.name ?? null,
      workerDni: d.operationWorker?.worker?.dni ?? null,
      pay_unit: d.pay_unit,
      pay_rate: d.pay_rate,
      total_bill: d.total_bill,
      total_paysheet: d.total_paysheet,
    }));

    if (!dryRun) {
      await db.billDetailSnapshot.createMany({ data: rows, skipDuplicates: true });
    }
    created += rows.length;
    log(`[detail] procesados hasta BillDetail ${lastId} — ${created} snapshots${dryRun ? ' (simulado)' : ''}`);
  }

  return created;
}

export async function runBackfill(db: Db, options: BackfillOptions = {}): Promise<BackfillResult> {
  const opts = {
    dryRun: options.dryRun ?? false,
    batchSize: options.batchSize ?? 500,
    log: options.log ?? (() => undefined),
  };
  const only = options.only ?? null;
  const result: BackfillResult = {
    tariffCreated: 0,
    tariffUnresolvedBillIds: [],
    workedFilled: 0,
    detailCreated: 0,
  };

  if (!only || only === 'tariff') {
    const r = await backfillTariffSnapshots(db, opts);
    result.tariffCreated = r.created;
    result.tariffUnresolvedBillIds = r.unresolved;
  }
  if (!only || only === 'worked') {
    result.workedFilled = await backfillWorkedHours(db, opts.dryRun, opts.log);
  }
  if (!only || only === 'detail') {
    result.detailCreated = await backfillDetailSnapshots(db, opts);
  }
  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyArg = args.find((a) => a.startsWith('--only='))?.split('=')[1] as Step | undefined;
  if (onlyArg && !['tariff', 'worked', 'detail'].includes(onlyArg)) {
    throw new Error(`--only inválido: ${onlyArg} (use tariff | worked | detail)`);
  }

  const prisma = new PrismaClient();
  try {
    // Mostrar la BD destino (sin credenciales) para no correrlo contra la equivocada.
    try {
      const url = new URL(process.env.DATABASE_URL ?? '');
      console.log(`[backfill] BD destino: ${url.hostname}:${url.port || '5432'}${url.pathname}`);
    } catch {
      console.log('[backfill] BD destino: (DATABASE_URL no legible)');
    }
    console.log(`[backfill] ${dryRun ? 'SIMULACIÓN (no escribe)' : 'EJECUCIÓN REAL'}${onlyArg ? ` — solo "${onlyArg}"` : ''}`);
    const result = await runBackfill(prisma, { dryRun, only: onlyArg ?? null, log: console.log });
    console.log('[backfill] Resultado:', JSON.stringify({
      ...result,
      tariffUnresolvedBillIds: result.tariffUnresolvedBillIds.slice(0, 50),
      tariffUnresolvedCount: result.tariffUnresolvedBillIds.length,
    }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[backfill] Error:', error);
    process.exitCode = 1;
  });
}
