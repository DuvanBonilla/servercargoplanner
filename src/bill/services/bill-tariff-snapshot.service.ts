import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StatusActivation, YES_NO } from '@prisma/client';

function toYesNo(value: any): YES_NO {
  return value === 'YES' ? YES_NO.YES : YES_NO.NO;
}

function toStatus(value: any): StatusActivation | null {
  if (value === 'ACTIVE') return StatusActivation.ACTIVE;
  if (value === 'INACTIVE') return StatusActivation.INACTIVE;
  return null;
}

@Injectable()
export class BillTariffSnapshotService {
  constructor(private prisma: PrismaService) {}

  /**
   * Congela en BillTariffSnapshot los valores de tarifa (tariffDetails, con la
   * misma forma que TariffTransformerService.transformTariffResponse) vigentes
   * al momento de crear una Bill, para que recálculos futuros no queden
   * expuestos a cambios posteriores de la Tariff en vivo.
   */
  async create(
    id_bill: number,
    tariffDetails: any,
    opts?: { isBackfilled?: boolean; billHours?: any },
  ) {
    if (!tariffDetails) return null;

    const hours = tariffDetails.hours ?? {};
    const billHours = opts?.billHours ?? {};
    const toNumOrNull = (v: any) => (v == null ? null : Number(v));

    const data = {
      id_bill,
      id_tariff: tariffDetails.id ?? null,
      code: tariffDetails.code ?? null,
      id_subtask: tariffDetails.subTask?.id ?? null,
      subTaskName: tariffDetails.subTask?.name ?? null,
      id_costCenter: tariffDetails.costCenter?.id ?? null,
      costCenterName: tariffDetails.costCenter?.name ?? null,
      costCenterCode: tariffDetails.costCenter?.code ?? null,
      id_unidOfMeasure: tariffDetails.unitOfMeasure?.id ?? null,
      unitOfMeasureName: tariffDetails.unitOfMeasure?.name ?? null,
      id_facturation_unit: tariffDetails.facturationUnit?.id ?? null,
      facturationUnitName: tariffDetails.facturationUnit?.name ?? null,
      paysheet_tariff: Number(tariffDetails.paysheet_tariff) || 0,
      facturation_tariff: Number(tariffDetails.facturation_tariff) || 0,
      full_tariff: toYesNo(tariffDetails.full_tariff),
      compensatory: toYesNo(tariffDetails.compensatory),
      isSpecial: tariffDetails.isSpecial ? toYesNo(tariffDetails.isSpecial) : null,
      alternative_paid_service: toYesNo(tariffDetails.alternative_paid_service),
      group_tariff: toYesNo(tariffDetails.group_tariff),
      settle_payment: toYesNo(tariffDetails.settle_payment),
      status: toStatus(tariffDetails.status),
      agreed_hours:
        tariffDetails.agreed_hours != null ? Number(tariffDetails.agreed_hours) : null,
      OD: Number(hours.OD) || 0,
      ON: Number(hours.ON) || 0,
      ED: Number(hours.ED) || 0,
      EN: Number(hours.EN) || 0,
      FOD: Number(hours.FOD) || 0,
      FON: Number(hours.FON) || 0,
      FED: Number(hours.FED) || 0,
      FEN: Number(hours.FEN) || 0,
      FAC_OD: Number(hours.FAC_OD) || 0,
      FAC_ON: Number(hours.FAC_ON) || 0,
      FAC_ED: Number(hours.FAC_ED) || 0,
      FAC_EN: Number(hours.FAC_EN) || 0,
      FAC_FOD: Number(hours.FAC_FOD) || 0,
      FAC_FON: Number(hours.FAC_FON) || 0,
      FAC_FED: Number(hours.FAC_FED) || 0,
      FAC_FEN: Number(hours.FAC_FEN) || 0,
      worked_HOD: toNumOrNull(billHours.HOD),
      worked_HON: toNumOrNull(billHours.HON),
      worked_HED: toNumOrNull(billHours.HED),
      worked_HEN: toNumOrNull(billHours.HEN),
      worked_HFOD: toNumOrNull(billHours.HFOD),
      worked_HFON: toNumOrNull(billHours.HFON),
      worked_HFED: toNumOrNull(billHours.HFED),
      worked_HFEN: toNumOrNull(billHours.HFEN),
      worked_FAC_HOD: toNumOrNull(billHours.FAC_HOD),
      worked_FAC_HON: toNumOrNull(billHours.FAC_HON),
      worked_FAC_HED: toNumOrNull(billHours.FAC_HED),
      worked_FAC_HEN: toNumOrNull(billHours.FAC_HEN),
      worked_FAC_HFOD: toNumOrNull(billHours.FAC_HFOD),
      worked_FAC_HFON: toNumOrNull(billHours.FAC_HFON),
      worked_FAC_HFED: toNumOrNull(billHours.FAC_HFED),
      worked_FAC_HFEN: toNumOrNull(billHours.FAC_HFEN),
      is_backfilled: opts?.isBackfilled ?? false,
    };

    return this.prisma.billTariffSnapshot.upsert({
      where: { id_bill },
      create: data,
      update: data,
    });
  }

  async findByBillId(id_bill: number) {
    return this.prisma.billTariffSnapshot.findUnique({ where: { id_bill } });
  }

  /**
   * Mantiene las horas trabajadas (worked_*) del snapshot iguales a las horas
   * actuales de la Bill. La tarifa del snapshot NO se toca: es lo único que queda
   * amarrado al momento de creación; las horas siguen a la factura cuando se recalcula.
   */
  async syncWorkedHoursFromBill(id_bill: number) {
    const bill = await this.prisma.bill.findUnique({ where: { id: id_bill } });
    if (!bill) return null;

    const num = (v: any) => (v == null ? null : Number(v));
    return this.prisma.billTariffSnapshot.updateMany({
      where: { id_bill },
      data: {
        worked_HOD: num(bill.HOD),
        worked_HON: num(bill.HON),
        worked_HED: num(bill.HED),
        worked_HEN: num(bill.HEN),
        worked_HFOD: num(bill.HFOD),
        worked_HFON: num(bill.HFON),
        worked_HFED: num(bill.HFED),
        worked_HFEN: num(bill.HFEN),
        worked_FAC_HOD: num(bill.FAC_HOD),
        worked_FAC_HON: num(bill.FAC_HON),
        worked_FAC_HED: num(bill.FAC_HED),
        worked_FAC_HEN: num(bill.FAC_HEN),
        worked_FAC_HFOD: num(bill.FAC_HFOD),
        worked_FAC_HFON: num(bill.FAC_HFON),
        worked_FAC_HFED: num(bill.FAC_HFED),
        worked_FAC_HFEN: num(bill.FAC_HFEN),
      },
    });
  }

  /**
   * Devuelve el tariffDetails que debe usarse al recalcular una Bill:
   * - Sin snapshot: la tarifa en vivo (como antes).
   * - Con snapshot y el grupo sigue apuntando a la MISMA tarifa (mismo id_tariff):
   *   los valores congelados, ignorando ediciones posteriores de la Tariff.
   * - Con snapshot pero el grupo ahora apunta a OTRA tarifa (cambió el servicio):
   *   la tarifa en vivo, y el snapshot se actualiza con ella.
   */
  async resolveTariffDetailsForRecalculation(
    id_bill: number,
    liveTariffDetails: any,
  ) {
    const snapshot = await this.findByBillId(id_bill);
    if (!snapshot) return liveTariffDetails;

    const liveTariffId = liveTariffDetails?.id;
    const serviceChanged =
      liveTariffId != null &&
      snapshot.id_tariff != null &&
      liveTariffId !== snapshot.id_tariff;

    if (!serviceChanged) {
      return this.toTariffDetailsShape(snapshot);
    }

    try {
      // Conserva las horas trabajadas (worked_*) ya congeladas: solo cambia la tarifa.
      const billHours = {
        HOD: snapshot.worked_HOD,
        HON: snapshot.worked_HON,
        HED: snapshot.worked_HED,
        HEN: snapshot.worked_HEN,
        HFOD: snapshot.worked_HFOD,
        HFON: snapshot.worked_HFON,
        HFED: snapshot.worked_HFED,
        HFEN: snapshot.worked_HFEN,
        FAC_HOD: snapshot.worked_FAC_HOD,
        FAC_HON: snapshot.worked_FAC_HON,
        FAC_HED: snapshot.worked_FAC_HED,
        FAC_HEN: snapshot.worked_FAC_HEN,
        FAC_HFOD: snapshot.worked_FAC_HFOD,
        FAC_HFON: snapshot.worked_FAC_HFON,
        FAC_HFED: snapshot.worked_FAC_HFED,
        FAC_HFEN: snapshot.worked_FAC_HFEN,
      };
      await this.create(id_bill, liveTariffDetails, { billHours });
    } catch (error) {
      console.error(
        `[BillTariffSnapshot] No se pudo actualizar el snapshot de la Bill ${id_bill} tras cambio de servicio:`,
        error,
      );
    }

    return liveTariffDetails;
  }

  /**
   * Reconstruye un objeto con la misma forma que `tariffDetails` (la que arma
   * TariffTransformerService.transformTariffResponse) a partir de una fila de
   * BillTariffSnapshot, para poder inyectarlo en matchingGroupSummary.tariffDetails
   * sin tocar el resto del código de cálculo.
   */
  toTariffDetailsShape(snapshot: any) {
    if (!snapshot) return null;

    return {
      id: snapshot.id_tariff,
      code: snapshot.code,
      subTask: snapshot.id_subtask
        ? { id: snapshot.id_subtask, name: snapshot.subTaskName, code: null, task: null }
        : null,
      costCenter: snapshot.id_costCenter
        ? {
            id: snapshot.id_costCenter,
            code: snapshot.costCenterCode,
            name: snapshot.costCenterName,
            client: null,
            subSite: null,
          }
        : null,
      unitOfMeasure: snapshot.id_unidOfMeasure
        ? { id: snapshot.id_unidOfMeasure, name: snapshot.unitOfMeasureName }
        : null,
      facturationUnit: snapshot.id_facturation_unit
        ? { id: snapshot.id_facturation_unit, name: snapshot.facturationUnitName }
        : null,
      paysheet_tariff: Number(snapshot.paysheet_tariff),
      facturation_tariff: Number(snapshot.facturation_tariff),
      full_tariff: snapshot.full_tariff,
      compensatory: snapshot.compensatory,
      alternative_paid_service: snapshot.alternative_paid_service,
      group_tariff: snapshot.group_tariff,
      settle_payment: snapshot.settle_payment,
      agreed_hours: snapshot.agreed_hours != null ? Number(snapshot.agreed_hours) : 0,
      hours: {
        OD: Number(snapshot.OD),
        ON: Number(snapshot.ON),
        ED: Number(snapshot.ED),
        EN: Number(snapshot.EN),
        FOD: Number(snapshot.FOD),
        FON: Number(snapshot.FON),
        FED: Number(snapshot.FED),
        FEN: Number(snapshot.FEN),
        FAC_OD: Number(snapshot.FAC_OD),
        FAC_ON: Number(snapshot.FAC_ON),
        FAC_ED: Number(snapshot.FAC_ED),
        FAC_EN: Number(snapshot.FAC_EN),
        FAC_FOD: Number(snapshot.FAC_FOD),
        FAC_FON: Number(snapshot.FAC_FON),
        FAC_FED: Number(snapshot.FAC_FED),
        FAC_FEN: Number(snapshot.FAC_FEN),
      },
      status: snapshot.status,
      isSpecial: snapshot.isSpecial,
      createdAt: snapshot.createdAt,
      updatedAt: snapshot.updatedAt,
    };
  }
}
