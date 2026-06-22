import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigurationService } from 'src/configuration/configuration.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WorkerGroupSummary } from '../entities/worker-group-analysis.types';
import { GroupBillDto, HoursDistribution } from '../dto/create-bill.dto';
import { BaseCalculationService } from './base-calculation.service';
import { getDayNamesInRange, hasSundayInRange } from 'src/common/utils/dateType';

export interface ProcessHoursGroupsResult {
  groupId: string;
  site: string;
  subSite: string;
  task: string;
  code_tariff: string;
  tariff: string;
  week_number: number;
  workerCount: number;
  totalFinalFacturation: number;
  totalFinalPayroll: number;
  details: {
    factHoursDistribution: HoursDistributionResult;
    paysheetHoursDistribution: HoursDistributionResult;
    compensatoryBill: CompensatoryResult;
    compensatoryPayroll: CompensatoryResult;
  };
  workers: any[]; // Assuming this is an array of worker objects
}

export interface HoursDistributionResult {
  totalHours: number;
  totalAmount: number;
  details: {
    workerCount: number;
    tariff: number;
    hoursDetail: Record<string, HourDetail>;
  };
}

export interface HourDetail {
  hours: number;
  multiplier: number;
  amount: number;
}

export interface CompensatoryResult {
  hours: number;
  amount: number;
}

@Injectable()
export class HoursCalculationService {
  constructor(
    private prisma: PrismaService,
    private configurationService: ConfigurationService,
    private baseCalculationService: BaseCalculationService,
  ) { }

  /**
   * Determina las horas semanales límite basado en si hay domingo en el rango de fechas
   */
  private async getWeeklyHoursLimit(startDate: Date, endDate: Date): Promise<number> {
    const hasSunday = hasSundayInRange(startDate, endDate);

    if (hasSunday) {
      const sundayHoursConfig = await this.configurationService.findOneByName('HORAS_SEMANALES_DOMINGO');
      if (sundayHoursConfig?.value) {
        return parseInt(sundayHoursConfig.value, 10);
      }
      return 48; // Valor por defecto para domingos
    } else {
      const weekHoursConfig = await this.configurationService.findOneByName('HORAS_SEMANALES');
      if (weekHoursConfig?.value) {
        return parseInt(weekHoursConfig.value, 10);
      }
      return 44; // Valor por defecto para días normales
    }
  }

  /**
   * Determina si se debe calcular compensatorio basado en la fecha
   */
  private shouldCalculateCompensatory(startDate: Date, endDate: Date): boolean {
    return !hasSundayInRange(startDate, endDate);
  }

  async calculateCompensatoryHours(hours: number, billStatus?: string, startDate?: Date, endDate?: Date): Promise<number> {


    // Si se proporcionan fechas, verificar si hay domingo
    if (startDate && endDate && !this.shouldCalculateCompensatory(startDate, endDate)) {
      // console.log('❌ No se calcula compensatorio para operaciones con domingo');
      return 0;
    }
    console.log('🔍 COMPENSATORIO DEBUG', {
      hours,
      billStatus,
      entraCondicion:
        billStatus !== 'COMPLETED' &&
        hours > 7.3333333,
    });

    // ✅ LÓGICA BASADA EN ESTADO DE FACTURA
    // Si la factura NO está completada, mostrar valor por defecto para verificación del usuario
    if (billStatus !== 'COMPLETED' && hours > 7.3333333) {
      // console.log(`✅ Factura NO completada - Compensatorio por defecto para verificación: ${hours} > 7.33 → 1.22222 horas`);
      return 1.222;
    }

    // ✅ OBTENER HORAS SEMANALES DINÁMICAMENTE
    const weekHours = startDate && endDate
      ? await this.getWeeklyHoursLimit(startDate, endDate)
      : 44; // Fallback a valor por defecto

    // ✅ CÁLCULO CORRECTO DEL COMPENSATORIO (para facturas completadas o <= 7.33 horas)
    const dayHours = weekHours / 6; // 7.333333 para 44 horas, 8 para 48 horas
    const compensatoryDay = dayHours / 6; // 1.222222 para 44 horas, 1.333333 para 48 horas
    const compensatoryPerHour = compensatoryDay / dayHours; // compensatorio por cada hora trabajada

    // ✅ USAR EL TIEMPO REAL DE LA OPERACIÓN, LIMITADO AL MÁXIMO DIARIO
    const effectiveHours = Math.min(hours, dayHours);
    const compensatoryHours = effectiveHours * compensatoryPerHour;

    return compensatoryHours;
  }

  /**
   * Procesa grupos con unidad de medida HORAS
   */
  async processHoursGroups(
    groupSummary: WorkerGroupSummary,
    group: GroupBillDto,
    billStatus?: string,
  ): Promise<ProcessHoursGroupsResult> {
    const gfmt = groupSummary as any;
    const combinedGroupData = {
      ...groupSummary,
      full_tariff:
        groupSummary.full_tariff ??
        gfmt.tariffDetails?.full_tariff ??
        'NO',

      compensatory:
        groupSummary.compensatory ??
        gfmt.tariffDetails?.compensatory ??
        'NO',

      billHoursDistribution: group.billHoursDistribution,
      paysheetHoursDistribution: group.paysheetHoursDistribution,
      amount: group.amount,
      pays: group.pays,
      group_hours: Number(group.group_hours) || 0,
      hours: groupSummary.hours ?? gfmt.tariffDetails?.hours ?? 0,
      facturation_tariff: groupSummary.facturation_tariff ?? gfmt.tariffDetails?.facturation_tariff ?? 0,
      paysheet_tariff: groupSummary.paysheet_tariff ?? gfmt.tariffDetails?.paysheet_tariff ?? 0,

    };
    console.log('FULL TARIFF FINAL', combinedGroupData.full_tariff);
    // Obtener fechas para validaciones
    let startDate: Date | null = null;
    let endDate: Date | null = null;

    if (groupSummary.dateRange?.start && groupSummary.dateRange?.end) {
      startDate = toLocalDate(groupSummary.dateRange.start);
      endDate = toLocalDate(groupSummary.dateRange.end);

      const diasSemana = getDayNamesInRange(startDate, endDate);
      const tieneDomingo = hasSundayInRange(startDate, endDate);
      const horasLimite = await this.getWeeklyHoursLimit(startDate, endDate);
    }



    const result = await this.calculateHoursGroupResult(combinedGroupData, billStatus, startDate, endDate);

    // console.log('processHoursGroups------------', result);
    return result;

  }

  private async calculateHoursGroupResult(combinedGroupData: any,
    billStatus?: string, startDate?: Date | null, endDate?: Date | null) {
    // ✅ USAR group_hours para el compensatorio (duración específica del grupo)
    const groupDuration = Number(combinedGroupData.group_hours) > 0
      ? Number(combinedGroupData.group_hours)
      : 0;

    const totalBillHours = groupDuration > 0
      ? groupDuration
      : (combinedGroupData.billHoursDistribution.HOD + combinedGroupData.billHoursDistribution.HON);

    const totalPaysheetHours = groupDuration > 0
      ? groupDuration
      : (combinedGroupData.paysheetHoursDistribution.HOD + combinedGroupData.paysheetHoursDistribution.HON);

    // console.log('🔍 HORAS BASE COMPENSATORIO', {
    //   groupId: combinedGroupData.groupId,

    //   groupDuration,

    //   HOD_PAYSHEET:
    //     combinedGroupData.paysheetHoursDistribution?.HOD,

    //   HON_PAYSHEET:
    //     combinedGroupData.paysheetHoursDistribution?.HON,

    //   HOD_BILL:
    //     combinedGroupData.billHoursDistribution?.HOD,

    //   HON_BILL:
    //     combinedGroupData.billHoursDistribution?.HON,

    //   totalPaysheetHours,

    //   usandoGroupDuration:
    //     groupDuration > 0,
    // });

    // Calcular horas compensatorias (pasando billStatus y fechas)
    const compBill = await this.calculateCompensatoryHours(
      totalBillHours,
      billStatus,
      startDate || undefined,
      endDate || undefined
    );
    const compPayroll = await this.calculateCompensatoryHours(
      totalPaysheetHours,
      billStatus,
      startDate || undefined,
      endDate || undefined
    );

    // Calcular montos de distribución de horas - PASANDO LAS FECHAS
    const factHoursDistributionTotal =
      this.baseCalculationService.calculateHoursByDistribution(
        combinedGroupData,
        combinedGroupData.billHoursDistribution,
        combinedGroupData.facturation_tariff ?? combinedGroupData.tariffDetails?.facturation_tariff ?? 0,
        true, // usar multiplicadores FAC_
        startDate || undefined,
        endDate || undefined
      );

    // console.log("Fact Hours Distribution Total:", JSON.stringify(factHoursDistributionTotal, null, 2));

    const paysheetHoursDistributionTotal =
      this.baseCalculationService.calculateHoursByDistribution(
        combinedGroupData,
        combinedGroupData.paysheetHoursDistribution,
        combinedGroupData.paysheet_tariff ?? combinedGroupData.tariffDetails?.paysheet_tariff ?? 0,
        false, // usar multiplicadores normales
        startDate || undefined,
        endDate || undefined
      );

    // ✅ VALIDAR TARIFAS ANTES DE CALCULAR COMPENSATORIO
    const facturationTariff = combinedGroupData.facturation_tariff || combinedGroupData.tariffDetails?.facturation_tariff || 0;
    const paysheetTariff = combinedGroupData.paysheet_tariff || combinedGroupData.tariffDetails?.paysheet_tariff || 0;
    const workerCount = combinedGroupData.workerCount || 1;

    // ✅ VALIDAR QUE LOS TOTALES NO SEAN NaN
    let totalFinalFacturation = factHoursDistributionTotal.totalAmount || 0;
    let totalFinalPayroll = paysheetHoursDistributionTotal.totalAmount || 0;

    // ✅ VALIDAR QUE NO SEAN NaN ANTES DE SUMAR
    if (isNaN(totalFinalFacturation)) {
      console.error('❌ totalFinalFacturation es NaN, usando 0');
      totalFinalFacturation = 0;
    }

    if (isNaN(totalFinalPayroll)) {
      console.error('❌ totalFinalPayroll es NaN, usando 0');
      totalFinalPayroll = 0;
    }

    const shouldCalculateComp = startDate && endDate
      ? this.shouldCalculateCompensatory(startDate, endDate)
      : true;

    // ✅ OBTENER compensatory CON FALLBACK
    const baseTariffCompensatory = combinedGroupData.compensatory ||
      combinedGroupData.tariffDetails?.compensatory ||
      'NO';

    // ✅ CALCULAR COMPENSATORIO SIEMPRE (se mostrará en la respuesta)
    const compensatoryBill = shouldCalculateComp ? compBill : 0;
    const compensatoryPayroll = shouldCalculateComp ? compPayroll : 0;

    const totalCompBill = compensatoryBill * workerCount * facturationTariff;
    const totalCompPayroll = compensatoryPayroll * workerCount * paysheetTariff;

    // ✅ INCLUIR COMPENSATORIO EN TOTALES
    // Para facturación: solo si la tarifa dice "YES"
    if (baseTariffCompensatory === 'YES' && shouldCalculateComp && !isNaN(totalCompBill)) {
      totalFinalFacturation += totalCompBill;
      // console.log('✅ Compensatorio INCLUIDO en total facturación (tarifa compensatory: YES)');
    }

    // console.log('COMPENSATORIO CREACION', {
    //   groupId: combinedGroupData.groupId,
    //   billStatus,
    //   totalPaysheetHours,
    //   compPayroll,
    //   paysheetTariff,
    //   workerCount,
    //   totalCompPayroll,
    //   full_tariff: combinedGroupData.full_tariff,
    //   compensatory: combinedGroupData.compensatory,
    // });

    // Para nómina: SIEMPRE incluir para servicios por HORAS
    if (shouldCalculateComp && !isNaN(totalCompPayroll)) {
      totalFinalPayroll += totalCompPayroll;
      // console.log('✅ Compensatorio INCLUIDO en total nómina (SIEMPRE para servicios HORAS)');
    }

    // ✅ VALIDACIÓN FINAL ANTES DE RETORNAR
    if (isNaN(totalFinalFacturation)) {
      console.error('❌ totalFinalFacturation final es NaN, corrigiendo a 0');
      totalFinalFacturation = 0;
    }

    if (isNaN(totalFinalPayroll)) {
      console.error('❌ totalFinalPayroll final es NaN, corrigiendo a 0');
      totalFinalPayroll = 0;
    }
    if (combinedGroupData.full_tariff === 'YES') { ////FULL TARIFA: se calcula el total de HORAS DE FACTURACION MÁS NÓ HORAS DEL GRUPO
      const sumHours = (
        Object.values(combinedGroupData.billHoursDistribution) as number[]
      ).reduce((a: number, b: number) => a + b, 0);
      totalFinalFacturation =
        facturationTariff * sumHours * workerCount;
    }

    return {
      groupId: combinedGroupData.groupId,
      site: combinedGroupData.site,
      subSite: combinedGroupData.subSite,
      task: combinedGroupData.task,
      code_tariff: combinedGroupData.code_tariff,
      tariff: combinedGroupData.tariff,
      workerCount: combinedGroupData.workerCount,
      totalFinalFacturation: totalFinalFacturation,
      totalFinalPayroll: totalFinalPayroll,
      week_number: combinedGroupData.week_number,
      details: {
        factHoursDistribution: factHoursDistributionTotal,
        paysheetHoursDistribution: paysheetHoursDistributionTotal,
        compensatoryBill: { hours: compBill || 0, amount: totalCompBill || 0 },
        compensatoryPayroll: { hours: compPayroll || 0, amount: totalCompPayroll || 0 },
      },
      workers: combinedGroupData.workers || [],
    };
  }

  public async calculateAlternativeService(
    group: WorkerGroupSummary,
    groupBill: GroupBillDto,
  ) {

    // Nómina (paysheet)
    let paysheetTotal = 0;
    if (
      group.unit_of_measure !== 'HORAS' &&
      group.unit_of_measure !== 'JORNAL'
    ) {
      // Por cantidad (ej: cajas, toneladas)
      paysheetTotal = Number(groupBill.amount || 0) * Number(group.paysheet_tariff || 0);
    } else {
      // Lógica tradicional
      paysheetTotal = this.baseCalculationService.calculateHoursByDistribution(
        group,
        groupBill.paysheetHoursDistribution,
        group.paysheet_tariff || 0,
        false,
      ).totalAmount;
    }

    // Facturación
    let billingTotal = 0;
    if (group.group_tariff === 'YES') {
      const groupHoursNum = groupBill.group_hours ? Number(groupBill.group_hours) : 0;
      billingTotal = groupHoursNum * (group.facturation_tariff || 0);
    } else if (
      group.facturation_unit !== 'HORAS' &&
      group.facturation_unit !== 'JORNAL'
    ) {
      billingTotal = Number(groupBill.amount || 0) * (group.facturation_tariff || 0);
    } else {
      billingTotal = this.baseCalculationService.calculateHoursByDistribution(
        group,
        groupBill.billHoursDistribution,
        group.facturation_tariff || 0,
        true,
      ).totalAmount;
    }

    return {
      paysheetTotal,
      billingTotal,
      groupId: group.groupId,
      workers: group.workers || [],
    };
  }
}

// Utilidad para convertir string 'YYYY-MM-DD' a fecha local
function toLocalDate(date: string | Date): Date {
  if (typeof date === 'string') {
    return new Date(
      Number(date.slice(0, 4)),
      Number(date.slice(5, 7)) - 1,
      Number(date.slice(8, 10))
    );
  }
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}