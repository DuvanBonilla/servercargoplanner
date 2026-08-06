/**
 * Script one-off: crea BillTariffSnapshot (is_backfilled = true) para las Bill que
 * existían antes de introducir el snapshot histórico de tarifas, usando la tarifa
 * VIGENTE al momento de correr este script (no la real del momento de creación de
 * la Bill, que no quedó registrada en ningún lado). Se corre una sola vez después
 * de aplicar la migración add_bill_tariff_snapshot.
 *
 * Uso: npx ts-node -r tsconfig-paths/register prisma/scripts/backfill-bill-tariff-snapshot.ts
 */
import { PrismaClient } from '@prisma/client';
import { createTariffInclude } from '../../src/tariff/entities/tariff-include.types';
import { TariffTransformerService } from '../../src/tariff/service/tariff-transformer.service';
import { BillTariffSnapshotService } from '../../src/bill/services/bill-tariff-snapshot.service';

const prisma = new PrismaClient();
const transformer = new TariffTransformerService();
const snapshotService = new BillTariffSnapshotService(prisma as any);

async function main() {
  const billsWithoutSnapshot = await prisma.bill.findMany({
    where: { tariffSnapshot: null },
    select: { id: true },
  });

  console.log(
    `[backfill] ${billsWithoutSnapshot.length} Bill sin BillTariffSnapshot encontradas.`,
  );

  let created = 0;
  let unresolved = 0;

  for (const [index, bill] of billsWithoutSnapshot.entries()) {
    const billDetail = await prisma.billDetail.findFirst({
      where: { id_bill: bill.id },
      include: {
        operationWorker: {
          include: {
            tariff: { include: createTariffInclude() },
          },
        },
      },
    });

    const tariff = billDetail?.operationWorker?.tariff;

    if (!tariff) {
      unresolved++;
      console.warn(
        `[backfill] ⚠️ Bill ${bill.id}: no se pudo resolver una tarifa (sin BillDetail/operationWorker/tariff). Revisar manualmente.`,
      );
      continue;
    }

    const tariffDetails = transformer.transformTariffResponse(tariff as any);
    await snapshotService.create(bill.id, tariffDetails, { isBackfilled: true });
    created++;

    if ((index + 1) % 100 === 0) {
      console.log(`[backfill] Progreso: ${index + 1}/${billsWithoutSnapshot.length}`);
    }
  }

  console.log(
    `[backfill] Terminado. Snapshots creados: ${created}. Sin resolver: ${unresolved}.`,
  );
}

main()
  .catch((error) => {
    console.error('[backfill] Error:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
