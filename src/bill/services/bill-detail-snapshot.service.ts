import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class BillDetailSnapshotService {
  constructor(private prisma: PrismaService) {}

  /**
   * Congela, para un BillDetail recién creado (Bill nueva), el pago y las
   * unidades que tuvo ese trabajador en ese momento, para que recálculos o
   * ediciones posteriores de la Bill no reescriban el historial mostrado en
   * el detalle de la operación. Solo debe llamarse una vez por BillDetail,
   * en su creación — nunca desde flujos de edición.
   */
  async create(data: {
    id_bill_detail: number;
    id_bill: number;
    id_operation_worker: number;
    workerName?: string | null;
    workerDni?: string | null;
    pay_unit?: number | null;
    pay_rate?: number | null;
    total_bill?: number | null;
    total_paysheet?: number | null;
  }) {
    return this.prisma.billDetailSnapshot.create({ data });
  }

  /**
   * Sincroniza los snapshots de detalle de una Bill con el estado ACTUAL de sus
   * BillDetail, para que el snapshot siga a la factura cuando se recalcula
   * (trabajador agregado/quitado, horas, pay_unit, tipo de tarifa, etc.).
   *
   * - BillDetail sin snapshot: se crea con sus valores actuales y nombre/DNI del trabajador.
   * - BillDetail con snapshot: se actualizan pay_unit, pay_rate y totales; el
   *   nombre/DNI congelados no se tocan.
   * Los BillDetail eliminados pierden su snapshot por ON DELETE CASCADE.
   */
  async syncForBill(id_bill: number) {
    const details = await this.prisma.billDetail.findMany({
      where: { id_bill },
      include: {
        operationWorker: {
          select: { worker: { select: { name: true, dni: true } } },
        },
      },
    });

    for (const detail of details) {
      const values = {
        id_bill: detail.id_bill,
        id_operation_worker: detail.id_operation_worker,
        pay_unit: detail.pay_unit,
        pay_rate: detail.pay_rate,
        total_bill: detail.total_bill,
        total_paysheet: detail.total_paysheet,
      };

      await this.prisma.billDetailSnapshot.upsert({
        where: { id_bill_detail: detail.id },
        create: {
          id_bill_detail: detail.id,
          workerName: detail.operationWorker?.worker?.name ?? null,
          workerDni: detail.operationWorker?.worker?.dni ?? null,
          ...values,
        },
        update: values,
      });
    }
  }

  async findManyByBillId(id_bill: number) {
    return this.prisma.billDetailSnapshot.findMany({ where: { id_bill } });
  }
}
