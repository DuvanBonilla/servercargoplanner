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

  async findManyByBillId(id_bill: number) {
    return this.prisma.billDetailSnapshot.findMany({ where: { id_bill } });
  }
}
