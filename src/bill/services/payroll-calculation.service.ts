import { ConflictException, Injectable } from '@nestjs/common';
import { getDateType, DayType } from '../../common/utils/dateType';
import { WorkerGroupSummary } from '../entities/worker-group-analysis.types';
import { GroupBillDto, HoursDistribution } from '../dto/create-bill.dto';
import { BaseCalculationService } from './base-calculation.service';

interface PayrollCalculationResult {
  baseAmount: number;
  additionalHoursAmount: number;
  holidayAmount: number;
  totalAmount: number;
  details: any;
}

@Injectable()
export class PayrollCalculationService {
  constructor(private baseCalculationService: BaseCalculationService) {}

  /**
   * Procesa grupos con unidad de medida JORNAL
   */
  processJornalGroups(
  groups: WorkerGroupSummary[],
  groupsData: GroupBillDto[],
  operationDate: Date | string | null,
) {
  let totalPayroll = 0;
  let totalBilling = 0;
  const groupResults: any[] = [];

  for (const group of groups) {
    const billData = groupsData.find((g) => g.id === group.groupId);
    const paysheetData = groupsData.find((g) => g.id === group.groupId);

    if (group.settle_payment && group.settle_payment === 'YES') {
      if (billData?.pays.length != group.workerCount) {
        throw new ConflictException(
          `El grupo ${group.groupId} tiene un número de trabajadores diferente al esperado: ${group.workerCount} trabajadores, pero se encontraron ${billData?.pays.length} pagos.`,
        );
      }

      for (const pay of billData?.pays || []) {
        if (group.workers.find((w) => w.id === pay.id_worker) === undefined) {
          throw new ConflictException(
            `El trabajador ${pay.id_worker} no está asignado al grupo ${group.groupId}.`,
          );
        }
      }
    }

    if (!billData || !paysheetData) {
      console.error(`No se encontraron datos para el grupo ${group.groupId}`);
      continue;
    }

    try {
      // ✅ PASAR PAYS A LOS MÉTODOS DE CÁLCULO
      const payrollResult = this.calculateJornalPayroll(
        group,
        paysheetData.paysheetHoursDistribution,
        operationDate,
        paysheetData.pays, // ✅ AGREGAR PAYS
      );

      totalPayroll += payrollResult.totalAmount;

      const billingResult = this.calculateJornalBilling(
        group,
        billData.billHoursDistribution,
        operationDate,
        billData.pays, // ✅ AGREGAR PAYS
      );
      
      totalBilling += billingResult.totalAmount;

      groupResults.push({
        groupId: group.groupId,
        site: group.site,
        subSite: group.subSite,
        dateRange: group.dateRange,
        timeRange: group.timeRange,
        week_number: group.week_number,
        task: group.task,
        code_tariff: group.code_tariff,
        tariff: group.tariff,
        unit_of_measure: group.unit_of_measure,
        workerCount: group.workerCount,
        payroll: payrollResult,
        billing: billingResult,
        observation: billData?.observation || '',
        workers: group.workers
      });
    } catch (error) {
      console.error(
        `Error al calcular para el grupo ${group.groupId}:`,
        error.message,
      );
      continue;
    }
  }

  return {
    message: 'Jornal groups processed successfully',
    groupResults,
  };
}

  /**
   * Calcula nómina para grupos JORNAL
   */
  calculateJornalPayroll(
    group: any,
    additionalHours: HoursDistribution,
    operationDate: Date | string | null,
    pays?: Array<{id_worker: number, pay: number}>, // ✅ AGREGAR PARÁMETRO PAYS
  ): PayrollCalculationResult {
    this.validateGroup(group, 'paysheet_tariff');

    const dateInfo = operationDate
      ? getDateType(operationDate)
      : { type: DayType.NORMAL };
    const isHolidayOrSunday =
      dateInfo.type === DayType.HOLIDAY || dateInfo.type === DayType.SUNDAY;

    // ✅ CALCULAR MONTO BASE CONSIDERANDO UNIDADES DE PAGO
    const baseAmount = this.calculateBaseAmountWithPayUnits(
      group,
      group.paysheet_tariff,
      pays,
    );

    // ✅ CALCULAR HORAS ADICIONALES CONSIDERANDO UNIDADES DE PAGO
    const additionalHoursResult = this.calculateAdditionalHoursWithPayUnits(
      group,
      additionalHours,
      group.paysheet_tariff,
      group.agreed_hours,
      false, // usar multiplicadores normales
      pays,
    );

    // Cálculo de días festivos
    const holidayResult = this.calculateHolidayAmount(
      group,
      baseAmount,
      isHolidayOrSunday,
      'FOD',
    );

    const totalAmount =
      baseAmount + additionalHoursResult.amount + holidayResult.amount;

    return {
      baseAmount,
      additionalHoursAmount: additionalHoursResult.amount,
      holidayAmount: holidayResult.amount,
      totalAmount,
      details: {
        workerCount: group.workerCount,
        tariff: group.paysheet_tariff,
        isHolidayOrSunday,
        holidayMultiplier: holidayResult.multiplier,
        additionalHoursDetail: additionalHoursResult.details,
      },
    };
  }

  /**
   * Calcula facturación para grupos JORNAL
   */
  calculateJornalBilling(
    group: any,
    additionalHours: HoursDistribution,
    operationDate: Date | string | null,
    pays?: Array<{id_worker: number, pay: number}>, // ✅ AGREGAR PARÁMETRO PAYS
  ): PayrollCalculationResult {
    this.validateGroup(group, 'facturation_tariff');

    const dateInfo = operationDate
      ? getDateType(operationDate)
      : { type: DayType.NORMAL };
    const isHolidayOrSunday =
      dateInfo.type === DayType.HOLIDAY || dateInfo.type === DayType.SUNDAY;

    // ✅ CALCULAR MONTO BASE CONSIDERANDO UNIDADES DE PAGO
    const baseAmount = this.calculateBaseAmountWithPayUnits(
      group,
      group.facturation_tariff,
      pays,
    );

    // ✅ CALCULAR HORAS ADICIONALES CONSIDERANDO UNIDADES DE PAGO
    const additionalHoursResult = this.calculateAdditionalHoursWithPayUnits(
      group,
      additionalHours,
      group.facturation_tariff,
      group.agreed_hours,
      true, // usar multiplicadores FAC_
      pays,
    );

    // Cálculo de días festivos
    const holidayResult = this.calculateHolidayAmount(
      group,
      baseAmount,
      isHolidayOrSunday,
      'FAC_FOD',
    );

    const totalAmount =
      baseAmount + additionalHoursResult.amount + holidayResult.amount;

    return {
      baseAmount,
      additionalHoursAmount: additionalHoursResult.amount,
      holidayAmount: holidayResult.amount,
      totalAmount,
      details: {
        workerCount: group.workerCount,
        tariff: group.facturation_tariff,
        isHolidayOrSunday,
        holidayMultiplier: holidayResult.multiplier,
        additionalHoursDetail: additionalHoursResult.details,
      },
    };
  }

  private validateGroup(group: any, tariffField: string) {
  const value = Number(group[tariffField]);
  if (isNaN(value) || value < 0
  ) {
    throw new Error(
      `El grupo ${group.groupId} tiene ${tariffField} invalida, debe ser mayor o igual a 0`,
    );
  }
  if (!group.agreed_hours) {
    throw new Error(
      `El grupo ${group.groupId} no tiene horas pactadas definidas`,
    );
  }
  if (!group.hours) {
    throw new Error(`El grupo ${group.groupId} no tiene recargos definidos`);
  }
  // Solo valida los recargos que existen en el objeto
  const requiredKeys = Object.keys(group.hours);
  for (const key of requiredKeys) {
    if (typeof group.hours[key] === 'undefined') {
      throw new Error(`El grupo ${group.groupId} no tiene el recargo '${key}' definido`);
    }
  }
}

  private calculateAdditionalHours(
    group: any,
    additionalHours: HoursDistribution,
    tariff: number,
    agreedHours: number,
    useFacturationMultipliers: boolean,
  ) {
    let amount = 0;
    const details = {};

    for (const [hourType, hours] of Object.entries(additionalHours)) {
      const normalizedHourType = hourType.startsWith('H')
        ? hourType.substring(1)
        : hourType;
      const multiplierKey = useFacturationMultipliers
        ? `FAC_${normalizedHourType}`
        : normalizedHourType;

      if (hours && hours > 0 && group.hours[multiplierKey]) {
        const hourAmount =
          (tariff / agreedHours) * hours * group.hours[multiplierKey];
        amount += hourAmount;

        details[hourType] = {
          hours,
          multiplier: group.hours[multiplierKey],
          amount: hourAmount,
        };
      }
    }

    return { amount, details };
  }

  private calculateHolidayAmount(
    group: any,
    baseAmount: number,
    isHolidayOrSunday: boolean,
    multiplierKey: string,
  ) {
    if (isHolidayOrSunday && group.hours[multiplierKey]) {
      const multiplier = group.hours[multiplierKey];
      const amount = multiplierKey.startsWith('FAC_')
        ? baseAmount * (multiplier - 1)
        : baseAmount * multiplier;
      return { amount, multiplier };
    }
    return { amount: 0, multiplier: 0 };
  }

  // ✅ NUEVO MÉTODO PARA CALCULAR MONTO BASE CON UNIDADES DE PAGO
private calculateBaseAmountWithPayUnits(
  group: any,
  tariff: number,
  pays?: Array<{id_worker: number, pay: number}>,
): number {
  if (!pays || pays.length === 0) {
    // Si no hay pays definidos, usar cálculo tradicional
    return this.baseCalculationService.calculateBaseAmount(
      group.workerCount,
      tariff,
    );
  }

  // ✅ SUMAR TODAS LAS UNIDADES DE PAGO Y MULTIPLICAR POR TARIFA
  const totalPayUnits = pays.reduce((sum, pay) => sum + (pay.pay || 1), 0);
  return totalPayUnits * tariff;
}

// ✅ NUEVO MÉTODO PARA CALCULAR HORAS ADICIONALES CON UNIDADES DE PAGO
private calculateAdditionalHoursWithPayUnits(
  group: any,
  additionalHours: HoursDistribution,
  tariff: number,
  agreedHours: number,
  useFacturationMultipliers: boolean,
  pays?: Array<{id_worker: number, pay: number}>,
) {
  let amount = 0;
  const details = {};

  // ✅ CALCULAR TOTAL DE UNIDADES DE PAGO
  const totalPayUnits = pays?.reduce((sum, pay) => sum + (pay.pay || 1), 0) || group.workerCount;

  for (const [hourType, hours] of Object.entries(additionalHours)) {
    const normalizedHourType = hourType.startsWith('H')
      ? hourType.substring(1)
      : hourType;
    const multiplierKey = useFacturationMultipliers
      ? `FAC_${normalizedHourType}`
      : normalizedHourType;

    if (hours && hours > 0 && group.hours[multiplierKey]) {
      // ✅ FÓRMULA CORREGIDA: (tarifa * unidades_pago / horas_pactadas) * horas * multiplicador
      const hourAmount =
        (tariff * totalPayUnits / agreedHours) * hours * group.hours[multiplierKey];
      amount += hourAmount;

      details[hourType] = {
        hours,
        multiplier: group.hours[multiplierKey],
        amount: hourAmount,
        payUnits: totalPayUnits, // ✅ AGREGAR INFO DE DEBUG
      };
    }
  }

  return { amount, details };
}
}
