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
    opts?: { isBackfilled?: boolean },
  ) {
    if (!tariffDetails) return null;

    const hours = tariffDetails.hours ?? {};

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
