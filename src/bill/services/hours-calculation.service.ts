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
  ) {}

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

  async calculateCompensatoryHours(hours: number, startDate?: Date, endDate?: Date): Promise<number> {
  // Si se proporcionan fechas, verificar si hay domingo
  if (startDate && endDate && !this.shouldCalculateCompensatory(startDate, endDate)) {
    console.log('No se calcula compensatorio para operaciones con domingo');
    return 0;
  }

  // ✅ OBTENER HORAS SEMANALES DINÁMICAMENTE
  const weekHours = startDate && endDate 
    ? await this.getWeeklyHoursLimit(startDate, endDate)
    : 44; // Fallback a valor por defecto

  // ✅ CÁLCULO CORRECTO DEL COMPENSATORIO
  const dayHours = weekHours / 6; // 7.333333 para 44 horas, 8 para 48 horas
  const compensatoryDay = dayHours / 6; // 1.222222 para 44 horas, 1.333333 para 48 horas
  const compensatoryPerHour = compensatoryDay / dayHours; // compensatorio por cada hora trabajada
  
  // ✅ USAR EL TIEMPO REAL DE LA OPERACIÓN, LIMITADO AL MÁXIMO DIARIO
  const effectiveHours = Math.min(hours, dayHours);
  const compensatoryHours = effectiveHours * compensatoryPerHour;

  console.log('=== CÁLCULO COMPENSATORIO CORREGIDO ===');
  console.log('weekHours:', weekHours);
  console.log('dayHours (valor máximo):', dayHours);
  console.log('compensatoryDay:', compensatoryDay);
  console.log('compensatoryPerHour:', compensatoryPerHour);
  console.log('hours (duración operación):', hours);
  console.log('effectiveHours (limitado):', effectiveHours);
  console.log('compensatoryHours (resultado):', compensatoryHours);
  console.log('=== FIN CÁLCULO COMPENSATORIO ===');

  return compensatoryHours;
}

  /**
   * Procesa grupos con unidad de medida HORAS
   */
  async processHoursGroups(
    groupSummary: WorkerGroupSummary,
    group: GroupBillDto,
  ): Promise<ProcessHoursGroupsResult> {
    const gfmt = groupSummary as any;
    const combinedGroupData = {
      ...groupSummary,
      billHoursDistribution: group.billHoursDistribution,
      paysheetHoursDistribution: group.paysheetHoursDistribution,
      amount: group.amount,
      pays: group.pays,
      hours: groupSummary.hours ?? gfmt.tariffDetails?.hours ?? 0,
      facturation_tariff: groupSummary.facturation_tariff ?? gfmt.tariffDetails?.facturation_tariff ?? 0,
      paysheet_tariff: groupSummary.paysheet_tariff ?? gfmt.tariffDetails?.paysheet_tariff ?? 0,
    };

    // ✅ AGREGAR LOGS PARA VERIFICAR op_duration
  console.log('=== VERIFICACIÓN OP_DURATION ===');
  console.log('groupSummary.op_duration:', groupSummary.op_duration);
  console.log('gfmt.op_duration:', gfmt.op_duration);
  console.log('combinedGroupData después de merge:', {
    op_duration: combinedGroupData.op_duration,
    dateRange: combinedGroupData.dateRange
  });
   
    // Obtener fechas para validaciones
  let startDate: Date | null = null;
  let endDate: Date | null = null;
  
  if (groupSummary.dateRange?.start && groupSummary.dateRange?.end) {
    startDate = toLocalDate(groupSummary.dateRange.start);
    endDate = toLocalDate(groupSummary.dateRange.end);

    console.log('=== ANÁLISIS DE FECHAS ===');
    console.log('startDate:', startDate.toISOString(), 'Día:', startDate.getDay());
    console.log('endDate:', endDate.toISOString(), 'Día:', endDate.getDay());

    const diasSemana = getDayNamesInRange(startDate, endDate);
    const tieneDomingo = hasSundayInRange(startDate, endDate);
    const horasLimite = await this.getWeeklyHoursLimit(startDate, endDate);
    
    console.log('Días de la semana en la operación:', diasSemana);
    console.log('¿Tiene domingo?', tieneDomingo);
    console.log('Horas límite semanales:', horasLimite);
    console.log('¿Calcular compensatorio?', this.shouldCalculateCompensatory(startDate, endDate));
    console.log('=== FIN ANÁLISIS FECHAS ===');
  }

  const result = await this.calculateHoursGroupResult(combinedGroupData, startDate, endDate);
  return result;
}

  private async calculateHoursGroupResult(combinedGroupData: any, startDate?: Date | null, endDate?: Date | null) {
  // ✅ USAR op_duration EN LUGAR DE HORAS DE DISTRIBUCIÓN
  console.log('=== CÁLCULO COMPENSATORIO ===');
  console.log('op_duration disponible:', combinedGroupData.op_duration);
  
  // Usar op_duration si está disponible, sino usar las horas de distribución como fallback
  const operationDuration = combinedGroupData.op_duration || 0;
  
  const totalBillHours = operationDuration > 0 
    ? operationDuration 
    : (combinedGroupData.billHoursDistribution.HOD + combinedGroupData.billHoursDistribution.HON);
    
  const totalPaysheetHours = operationDuration > 0 
    ? operationDuration 
    : (combinedGroupData.paysheetHoursDistribution.HOD + combinedGroupData.paysheetHoursDistribution.HON);

  console.log('Horas para compensatorio:', {
    operationDuration,
    totalBillHours,
    totalPaysheetHours,
    usingOpDuration: operationDuration > 0
  });

  // Calcular horas compensatorias (pasando las fechas)
  const compBill = await this.calculateCompensatoryHours(
    totalBillHours, 
    startDate || undefined, 
    endDate || undefined
  );
  const compPayroll = await this.calculateCompensatoryHours(
    totalPaysheetHours, 
    startDate || undefined, 
    endDate || undefined
  );

  console.log('Compensatorio calculado:', {
    compBill,
    compPayroll
  });

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

  console.log("Fact Hours Distribution Total:", JSON.stringify(factHoursDistributionTotal, null, 2));

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

  console.log('=== VALIDACIÓN TARIFAS ===');
  console.log('facturationTariff:', facturationTariff);
  console.log('paysheetTariff:', paysheetTariff);
  console.log('workerCount:', workerCount);
  console.log('compBill:', compBill);
  console.log('compPayroll:', compPayroll);

  // ✅ CALCULAR MONTOS COMPENSATORIOS CON VALIDACIÓN
  const totalCompBill = (compBill && facturationTariff) 
    ? compBill * workerCount * facturationTariff
    : 0;

  const totalCompPayroll = (compPayroll && paysheetTariff) 
    ? compPayroll * workerCount * paysheetTariff
    : 0;

  console.log('=== MONTOS COMPENSATORIOS ===');
  console.log('totalCompBill:', totalCompBill);
  console.log('totalCompPayroll:', totalCompPayroll);

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
  const compensatoryFlag = combinedGroupData.compensatory || 
                          combinedGroupData.tariffDetails?.compensatory || 
                          'NO';

  console.log('=== FLAGS DE CONTROL ===');
  console.log('compensatoryFlag:', compensatoryFlag);
  console.log('shouldCalculateComp:', shouldCalculateComp);

  // ✅ PARA FACTURACIÓN: Solo sumar compensatorio si compensatory = 'YES' y no hay domingo
  if (compensatoryFlag === 'YES' && shouldCalculateComp && !isNaN(totalCompBill)) {
    totalFinalFacturation += totalCompBill;
    console.log('✅ Compensatorio FACTURACIÓN sumado:', totalCompBill);
  } else {
    console.log('❌ Compensatorio FACTURACIÓN NO sumado - compensatory:', compensatoryFlag, 'shouldCalculateComp:', shouldCalculateComp);
  }

  // ✅ PARA NÓMINA: SIEMPRE sumar compensatorio en grupos HORAS (sin importar compensatory flag)
  if (shouldCalculateComp && !isNaN(totalCompPayroll)) {
    totalFinalPayroll += totalCompPayroll;
    console.log('✅ Compensatorio NÓMINA SIEMPRE sumado:', totalCompPayroll);
  } else {
    console.log('❌ Compensatorio NÓMINA NO sumado - shouldCalculateComp:', shouldCalculateComp, 'isNaN:', isNaN(totalCompPayroll));
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

  console.log('=== TOTALES FINALES ===');
  console.log('totalFinalFacturation:', totalFinalFacturation);
  console.log('totalFinalPayroll:', totalFinalPayroll);
  console.log('=== FIN TOTALES FINALES ===');

  if (combinedGroupData.full_tariff === 'YES') {
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
      paysheetTotal = (groupBill.amount || 0) * (group.paysheet_tariff || 0);
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
      billingTotal = (groupBill.amount || 0) * (group.facturation_tariff || 0);
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