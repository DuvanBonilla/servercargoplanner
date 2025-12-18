import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CreateBillDto, GroupBillDto } from './dto/create-bill.dto';
import { UpdateBillDto } from './dto/update-bill.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { OperationFinderService } from 'src/operation/services/operation-finder.service';
import { WorkerGroupAnalysisService } from './services/worker-group-analysis.service';
import { PayrollCalculationService } from './services/payroll-calculation.service';
import { HoursCalculationService } from './services/hours-calculation.service';
import { ConfigurationService } from 'src/configuration/configuration.service';
import {
  getWeekNumber,
  hasSundayInRange,
  getDayName,
} from 'src/common/utils/dateType';
import { BaseCalculationService } from './services/base-calculation.service';
import { group } from 'console';
import { BillStatus } from '@prisma/client';
import {
  getColombianDateTime,
  getColombianTimeString,
} from 'src/common/utils/dateColombia';

@Injectable()
export class BillService {
  constructor(
    private prisma: PrismaService,
    private operationFinderService: OperationFinderService,
    private workerGroupAnalysisService: WorkerGroupAnalysisService,
    private payrollCalculationService: PayrollCalculationService,
    private hoursCalculationService: HoursCalculationService,
    private baseCalculationService: BaseCalculationService,
    private configurationService: ConfigurationService
  ) {}
  async create(createBillDto: CreateBillDto, userId: number) {
    console.log('=== [BillService] Iniciando creación de factura ===');
    console.log('[BillService] userId:', userId);
    console.log('[BillService] createBillDto:', JSON.stringify(createBillDto, null, 2));
    
    // ✅ VALIDAR QUE EXISTA id_operation
    if (!createBillDto.id_operation) {
      console.error('[BillService] ❌ Error: id_operation no proporcionado');
      throw new ConflictException('El ID de la operación es obligatorio para crear una factura');
    }

    // ✅ VALIDAR QUE EXISTAN GRUPOS
    if (!createBillDto.groups || createBillDto.groups.length === 0) {
      console.error('[BillService] ❌ Error: No se proporcionaron grupos');
      throw new ConflictException('La operación debe tener al menos un grupo de trabajadores para facturar');
    }

    console.log(`[BillService] ✅ Validación básica correcta: ${createBillDto.groups.length} grupos a procesar`);

    const validateOperationID = await this.validateOperation(
      createBillDto.id_operation,
    );
    if (validateOperationID['status'] === 404) {
      return validateOperationID;
    }

    console.log('[BillService] ✅ Operación validada correctamente');

    // Procesar todos los tipos de grupos
    await this.processJornalGroups(createBillDto, userId, validateOperationID);
    await this.processSimpleHoursGroups(
      createBillDto,
      userId,
      validateOperationID,
    );
    await this.processAlternativeServiceGroups(
      createBillDto,
      userId,
      validateOperationID,
    );
    await this.processQuantityGroups(
      createBillDto,
      userId,
      validateOperationID,
      0,
    );

    console.log('[BillService] ✅ Factura creada exitosamente');

    return {
      message: 'Cálculos y guardado de facturación realizados con éxito',
    };
  }

  // Validar operación
 private async validateOperation(operationId: number) {
  const validateOperationID =
    await this.operationFinderService.getOperationWithDetailedTariffs(
      operationId,
    );

  if (!validateOperationID || validateOperationID.status === 404) {
    throw new NotFoundException('Operation not found');
  }

  // ✅ AGREGAR LOG PARA VERIFICAR QUE op_duration LLEGUE CORRECTAMENTE
  console.log('=== VALIDATE OPERATION ===');
  console.log('validateOperationID.op_duration:', validateOperationID.op_duration);
  console.log('validateOperationID.workerGroups:', validateOperationID.workerGroups?.length);
  
  if (validateOperationID.workerGroups) {
    validateOperationID.workerGroups.forEach((group, index) => {
      console.log(`Grupo ${index + 1} - op_duration:`, group.op_duration);
    });
  }
  console.log('=== FIN VALIDATE OPERATION ===');

  return validateOperationID;
}

  // Procesar grupos JORNAL
  private async processJornalGroups(
    createBillDto: CreateBillDto,
    userId: number,
    validateOperationID: any,
  ) {
    const jornalGroups =
      await this.workerGroupAnalysisService.findGroupsByCriteria(
        validateOperationID.workerGroups,
        { unit_of_measure: 'JORNAL', alternative_paid_service: 'NO' },
      );

    const jornalGroupsFiltered = jornalGroups.filter((jg) =>
      createBillDto.groups.some((g) => String(g.id) === String(jg.groupId)),
    );

    if (jornalGroupsFiltered.length === 0) return;

    const operationDate = jornalGroups[0].dateRange.start;
    const calculationResults =
      this.payrollCalculationService.processJornalGroups(
        jornalGroupsFiltered,
        createBillDto.groups,
        operationDate,
      );

    for (const result of calculationResults.groupResults) {
      const groupDto = this.getGroupDto(createBillDto.groups, result.groupId);

         
    // ✅ AGREGAR INFORMACIÓN DE LA OPERACIÓN AL RESULTADO
    result.operation = {
      dateStart: validateOperationID.dateStart,
      timeStrat: validateOperationID.timeStrat, // Usar el nombre real con typo
      dateEnd: validateOperationID.dateEnd,
      timeEnd: validateOperationID.timeEnd,
    };

      const billData = this.prepareBillData(
        result,
        createBillDto.id_operation,
        userId,
        groupDto,
      );
      const billSaved = await this.prisma.bill.create({ data: billData });

      await this.processBillDetails(
        result.workers,
        billSaved.id,
        createBillDto.id_operation,
        groupDto,
        result,
      );
    }
  }

  // Procesar grupos HORAS (sin servicio alternativo)
  private async processSimpleHoursGroups(
  createBillDto: CreateBillDto,
  userId: number,
  validateOperationID: any,
) {
  const simpleHoursGroups =
    await this.workerGroupAnalysisService.findGroupsByCriteria(
      validateOperationID.workerGroups,
      {
        unit_of_measure: 'HORAS',
        alternative_paid_service: 'NO',
      },
    );

  const simpleHoursGroupsFiltered = simpleHoursGroups.filter((shg) =>
    createBillDto.groups.some((g) => String(g.id) === String(shg.groupId)),
  );

  if (simpleHoursGroupsFiltered.length === 0) return;

  // ✅ AGREGAR LOG PARA VERIFICAR op_duration DE LA OPERACIÓN
  console.log('=== OPERACIÓN PRINCIPAL ===');
  console.log('validateOperationID.op_duration:', validateOperationID.op_duration);

  for (const matchingGroupSummary of simpleHoursGroupsFiltered) {
    const group = createBillDto.groups.find(
      (g) =>
        String(g.id).trim() === String(matchingGroupSummary.groupId).trim(),
    );
    if (!group) continue;

    // ✅ VERIFICAR QUE op_duration ESTÉ EN EL SUMMARY
    console.log('=== GRUPO INDIVIDUAL ===');
    console.log('matchingGroupSummary.op_duration:', matchingGroupSummary.op_duration);

    const result = await this.hoursCalculationService.processHoursGroups(
      matchingGroupSummary,
      group,
    );
    
    const billData = this.prepareHoursBillData(
      result,
      createBillDto.id_operation,
      userId,
      group,
    );
    const billSaved = await this.prisma.bill.create({
      data: {
        ...billData,
      },
    });

    await this.processHoursBillDetails(
      matchingGroupSummary.workers,
      billSaved.id,
      createBillDto.id_operation,
      group,
      result,
    );
  }
}

  // Procesar grupos con servicio alternativo
  private async processAlternativeServiceGroups(
    createBillDto: CreateBillDto,
    userId: number,
    validateOperationID: any,
  ) {
    const twoUnitsGroups =
      await this.workerGroupAnalysisService.findGroupsByCriteria(
        validateOperationID.workerGroups,
        { alternative_paid_service: 'YES' },
      );

    const twoUnitsGroupsFiltered = twoUnitsGroups.filter((tug) =>
      createBillDto.groups.some((g) => String(g.id) === String(tug.groupId)),
    );

    if (twoUnitsGroupsFiltered.length === 0) return;

    for (const matchingGroupSummary of twoUnitsGroupsFiltered) {
      const group = createBillDto.groups.find(
        (g) =>
          String(g.id).trim() === String(matchingGroupSummary.groupId).trim(),
      );
      if (!group) continue;

      const { totalFacturation, totalPaysheet } =
        await this.calculateAlternativeServiceTotals(
          matchingGroupSummary,
          group,
        );

      // // Calcular duración real del grupo
      // const groupDuration = await this.calcularDuracionGrupo(
      //   createBillDto.id_operation,
      //   group.id
      // );

      const billData = this.prepareAlternativeServiceBillData(
        matchingGroupSummary,
        group,
        totalFacturation,
        totalPaysheet,
        createBillDto.id_operation,
        userId,
      );

      const billSaved = await this.prisma.bill.create({
        data: {
          ...billData,
          group_hours: group.group_hours,
        },
      });

      await this.processAlternativeServiceBillDetails(
        matchingGroupSummary.workers,
        billSaved.id,
        createBillDto.id_operation,
        group,
        totalFacturation,
        totalPaysheet,
        matchingGroupSummary,
      );
    }
  }
  private async calcularDuracionGrupo(
    id_operation: number,
    id_group: string | number,
  ): Promise<number> {
    const workersGrupo = await this.prisma.operation_Worker.findMany({
      where: {
        id_operation,
        id_group: String(id_group),
      },
    });

    let totalHoras = 0;
    let count = 0;
    for (const w of workersGrupo) {
      if (w.dateStart && w.timeStart && w.dateEnd && w.timeEnd) {
        const start = new Date(w.dateStart);
        const [sh, sm] = w.timeStart.split(':').map(Number);
        start.setHours(sh, sm, 0, 0);
        const end = new Date(w.dateEnd);
        const [eh, em] = w.timeEnd.split(':').map(Number);
        end.setHours(eh, em, 0, 0);
        const diff = (end.getTime() - start.getTime()) / 3_600_000;
        if (diff > 0) {
          totalHoras += diff;
          count++;
        }
      }
    }
    return count > 0 ? Math.round((totalHoras / count) * 100) / 100 : 0;
  }

  private async processQuantityGroups(
    createBillDto: CreateBillDto,
    userId: number,
    validateOperationID: any,
    amountDb: number,
  ) {
    // Si validateOperationID es un array de grupos, úsalo directamente
    const groupsSource = Array.isArray(validateOperationID.workerGroups)
      ? validateOperationID.workerGroups
      : validateOperationID;

    const quantityGroups = groupsSource.filter(
      (group) =>
        group.schedule?.unit_of_measure !== 'HORAS' &&
        group.schedule?.unit_of_measure !== 'JORNAL' &&
        group.schedule?.alternative_paid_service !== 'YES' &&
        // Acepta null o undefined en cualquiera de los dos campos
        (group.schedule?.id_facturation_unit === null ||
          group.schedule?.id_facturation_unit === undefined) &&
        (!group.tariffDetails?.facturationUnit ||
          group.tariffDetails?.facturationUnit === null),
    );

    const quantityGroupsFiltered = quantityGroups.filter((qg) =>
      createBillDto.groups.some((g) => String(g.id) === String(qg.groupId)),
    );

    if (quantityGroupsFiltered.length === 0) return;

    for (const group of createBillDto.groups) {
      const matchingGroupSummary = quantityGroupsFiltered.find(
        (summary) => summary.groupId === group.id
      );
      if (!matchingGroupSummary) continue;

      const { totalPaysheet, totalFacturation } = this.calculateQuantityTotals(
        matchingGroupSummary,
        group,
        amountDb,
      );

      // // Calcular duración real del grupo
      // const groupDuration = await this.calcularDuracionGrupo(
      //   createBillDto.id_operation,
      //   group.id
      // );

      const billData = this.prepareQuantityBillData(
        matchingGroupSummary,
        group,
        totalPaysheet,
        totalFacturation,
        createBillDto.id_operation,
        userId,
      );

      const billSaved = await this.prisma.bill.create({
        data: {
          ...billData,
        },
      });

      await this.processQuantityBillDetails(
        matchingGroupSummary.workers,
        billSaved.id,
        createBillDto.id_operation,
        group,
        totalPaysheet,
        totalFacturation,
        matchingGroupSummary,
      );
    }
  }

  // Calcular totales para servicio alternativo
  private async calculateAlternativeServiceTotals(
    matchingGroupSummary: any,
    group: GroupBillDto,
  ) {
    const facturationUnit =
      matchingGroupSummary.facturation_unit ||
      matchingGroupSummary.schedule.facturation_unit ||
      matchingGroupSummary.schedule.unit_of_measure;
    const facturationTariff =
      matchingGroupSummary.facturation_tariff ??
      matchingGroupSummary.tariffDetails?.facturation_tariff ??
      0;
    const paysheetUnit =
      matchingGroupSummary.unit_of_measure ??
      matchingGroupSummary.schedule.unit_of_measure;
    const paysheetTariff =
      matchingGroupSummary.paysheet_tariff ??
      matchingGroupSummary.tariffDetails?.paysheet_tariff ??
      0;

    let totalFacturation = 0;
    let totalPaysheet = 0;

    // Calcular facturación
    if (facturationUnit === 'HORAS' || facturationUnit === 'JORNAL') {
      if (matchingGroupSummary.group_tariff === 'YES') {
        const factResult =
          group.group_hours * (matchingGroupSummary.facturation_tariff ?? 0);
        totalFacturation = factResult;
      } else if (facturationUnit === 'HORAS') {
        const factResult =
          await this.hoursCalculationService.processHoursGroups(
            matchingGroupSummary,
            group,
          );
        totalFacturation = factResult.totalFinalFacturation;
      } else {
        const factResult = this.payrollCalculationService.processJornalGroups(
          [matchingGroupSummary],
          [group],
          matchingGroupSummary.dateRange.start,
        );
        totalFacturation = factResult.groupResults[0].billing.totalAmount;
      }
    } else {
      const amount = group.amount || 0;
      totalFacturation = amount * facturationTariff;
    }

    // Calcular nómina
    if (paysheetUnit === 'HORAS') {
      const paysheetResult =
        await this.hoursCalculationService.processHoursGroups(
          matchingGroupSummary,
          group,
        );
      totalPaysheet = paysheetResult.totalFinalPayroll;
    } else if (paysheetUnit === 'JORNAL') {
      const paysheetResult = this.payrollCalculationService.processJornalGroups(
        [matchingGroupSummary],
        [group],
        matchingGroupSummary.dateRange.start,
      );
      totalPaysheet = paysheetResult.groupResults[0].payroll.totalAmount;
    } else {
      const amount = group.amount || 0;
      totalPaysheet = amount * paysheetTariff;
      console.log('Amount:', amount, 'Paysheet Tariff:', paysheetTariff);
    }

    return { totalFacturation, totalPaysheet };
  }

  // Calcular totales para grupos por cantidad
  private calculateQuantityTotals(
    matchingGroupSummary: any,
    group: GroupBillDto,
    amountDb: number,
  ) {
    const paysheetTariff =
      matchingGroupSummary.tariffDetails?.paysheet_tariff ?? 0;
    const facturationTariff =
      matchingGroupSummary.tariffDetails?.facturation_tariff ?? 0;
    const amount = group.amount ?? amountDb ?? 0;
    return {
      totalPaysheet: amount * paysheetTariff,
      totalFacturation: amount * facturationTariff,
    };
  }

  // Obtener DTO de grupo
  private getGroupDto(groups: GroupBillDto[], groupId: string): GroupBillDto {
    const groupDto = groups.find((g) => g.id === groupId);
    if (!groupDto) {
      throw new ConflictException(`No se encontró el grupo con ID: ${groupId}`);
    }
    return groupDto;
  }

  // Preparar datos de facturación para grupos JORNAL
  private prepareBillData(
    result: any,
    operationId: number,
    userId: number,
    groupDto: GroupBillDto,
  ) {
    // ✅ OBTENER FECHAS CORRECTAS DE LA OPERACIÓN
    const operation = result.operation || result.operationData;

    // ✅ USAR FECHAS REALES DE LA OPERACIÓN (no calcular)
    const realDateStart = operation?.dateStart || result.dateStart;
    const realTimeStart = operation?.timeStrat || result.timeStart; // Nota: timeStrat (con typo) es el nombre real en BD
    const realDateEnd = operation?.dateEnd || result.dateEnd;
    const realTimeEnd = operation?.timeEnd || result.timeEnd;

    // ✅ CALCULAR DURACIÓN REAL BASADA EN FECHAS DE OPERACIÓN
    let realDuration = 0;
    if (realDateStart && realTimeStart && realDateEnd && realTimeEnd) {
      const start = new Date(realDateStart);
      const [sh, sm] = realTimeStart.split(':').map(Number);
      start.setHours(sh, sm, 0, 0);

      const end = new Date(realDateEnd);
      const [eh, em] = realTimeEnd.split(':').map(Number);
      end.setHours(eh, em, 0, 0);

      realDuration =
        Math.round(
          ((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * 100,
        ) / 100;
    }
    const additionalHours = [
      groupDto.paysheetHoursDistribution.HED || 0,
      0,
      0,
      groupDto.paysheetHoursDistribution.HEN || 0,
      groupDto.paysheetHoursDistribution.HFED || 0,
      groupDto.paysheetHoursDistribution.HFEN || 0,
      0,
      0,
    ];

    return {
      week_number: result.week_number,
      id_operation: operationId,
      id_user: userId,
      amount: 0,
      number_of_workers: result.workerCount,
      total_bill: result.billing.totalAmount,
      total_paysheet: result.payroll.totalAmount,
      number_of_hours: additionalHours.reduce((sum, h) => sum + h, 0),
      createdAt: new Date(),
      HED: additionalHours[0],
      HON: additionalHours[1],
      HOD: additionalHours[2],
      HEN: additionalHours[3],
      HFED: additionalHours[4],
      HFEN: additionalHours[5],
      HFOD: additionalHours[6],
      HFON: additionalHours[7],
      FAC_HED: groupDto.billHoursDistribution.HED || 0,
      FAC_HON: 0,
      FAC_HOD: 0,
      FAC_HEN: groupDto.billHoursDistribution.HEN || 0,
      FAC_HFED: groupDto.billHoursDistribution.HFED || 0,
      FAC_HFEN: groupDto.billHoursDistribution.HFEN || 0,
      FAC_HFOD: 0,
      FAC_HFON: 0,
      observation: result?.observation || '',
      id_group: result.groupId,
    };
  }

  // Preparar datos para grupos HORAS
  private prepareHoursBillData(
    result: any,
    operationId: number,
    userId: number,
    groupDto: GroupBillDto,
  ) {

    // ✅ OBTENER FECHAS CORRECTAS DE LA OPERACIÓN
  const operation = result.operation || result.operationData;
  
  const realDateStart = operation?.dateStart || result.dateStart;
  const realTimeStart = operation?.timeStrat || result.timeStart;
  const realDateEnd = operation?.dateEnd || result.dateEnd;
  const realTimeEnd = operation?.timeEnd || result.timeEnd;

  // ✅ CALCULAR DURACIÓN REAL
  let realDuration = 0;
  if (realDateStart && realTimeStart && realDateEnd && realTimeEnd) {
    const start = new Date(realDateStart);
    const [sh, sm] = realTimeStart.split(':').map(Number);
    start.setHours(sh, sm, 0, 0);

    const end = new Date(realDateEnd);
    const [eh, em] = realTimeEnd.split(':').map(Number);
    end.setHours(eh, em, 0, 0);

    realDuration = Math.round(((end.getTime() - start.getTime()) / (1000 * 60 * 60)) * 100) / 100;
  }
    return {
      week_number: result.week_number,
      id_operation: operationId,
      id_user: userId,
      amount: 0,
      number_of_workers: result.workerCount,
      total_bill: result.totalFinalFacturation,
      total_paysheet: result.totalFinalPayroll,
      number_of_hours: result.details.factHoursDistribution.totalHours,
      createdAt: new Date(),
      HED:
        result.details.paysheetHoursDistribution.details.hoursDetail['HED']
          ?.hours || 0,
      HON:
        result.details.paysheetHoursDistribution.details.hoursDetail['HON']
          ?.hours || 0,
      HOD:
        result.details.paysheetHoursDistribution.details.hoursDetail['HOD']
          ?.hours || 0,
      HEN:
        result.details.paysheetHoursDistribution.details.hoursDetail['HEN']
          ?.hours || 0,
      HFED:
        result.details.paysheetHoursDistribution.details.hoursDetail['HFED']
          ?.hours || 0,
      HFEN:
        result.details.paysheetHoursDistribution.details.hoursDetail['HFEN']
          ?.hours || 0,
      HFOD:
        result.details.paysheetHoursDistribution.details.hoursDetail['HFOD']
          ?.hours || 0,
      HFON:
        result.details.paysheetHoursDistribution.details.hoursDetail['HFON']
          ?.hours || 0,
      FAC_HED:
        result.details.factHoursDistribution.details.hoursDetail['HED']
          ?.hours || 0,
      FAC_HON:
        result.details.factHoursDistribution.details.hoursDetail['HON']
          ?.hours || 0,
      FAC_HOD:
        result.details.factHoursDistribution.details.hoursDetail['HOD']
          ?.hours || 0,
      FAC_HEN:
        result.details.factHoursDistribution.details.hoursDetail['HEN']
          ?.hours || 0,
      FAC_HFED:
        result.details.factHoursDistribution.details.hoursDetail['HFED']
          ?.hours || 0,
      FAC_HFEN:
        result.details.factHoursDistribution.details.hoursDetail['HFEN']
          ?.hours || 0,
      FAC_HFOD:
        result.details.factHoursDistribution.details.hoursDetail['HFOD']
          ?.hours || 0,
      FAC_HFON:
        result.details.factHoursDistribution.details.hoursDetail['HFON']
          ?.hours || 0,
      observation: groupDto.observation || '', // Agregar esta línea
      id_group: result.groupId,
    };
  }

  /**
   * Calcula el valor del compensatorio para una factura
   */
  private async calculateCompensatoryForBill(billDB: any): Promise<any> {
  try {
    const opDuration = billDB.operation?.op_duration;
    if (typeof opDuration === 'undefined' || opDuration === null) {
      return {
        hours: 0,
        amount: 0,
        percentage: 0,
        error: 'No se encontró la duración de la operación (op_duration)',
      };
    }

    // Normalizar fechas a local CORRECTAMENTE
    const toLocalDate = (date: string | Date) => {
      if (typeof date === 'string') {
        const y = Number(date.slice(0, 4));
        const m = Number(date.slice(5, 7)) - 1;
        const d = Number(date.slice(8, 10));
        return new Date(y, m, d);
      }
      return new Date(date.getFullYear(), date.getMonth(), date.getDate());
    };

    const startDate = billDB.operation?.dateStart
      ? toLocalDate(billDB.operation.dateStart)
      : undefined;
    const endDate = billDB.operation?.dateEnd
      ? toLocalDate(billDB.operation.dateEnd)
      : undefined;

    // VERIFICAR SI HAY DOMINGO REAL
    let hasSundayReal = false;
    if (startDate && endDate) {
      hasSundayReal = hasSundayInRange(startDate, endDate);
    }

    if (hasSundayReal) {
      return {
        hours: 0,
        amount: 0,
        percentage: 0,
        info: 'No se calcula compensatorio porque hay domingo en el rango',
      };
    }

    // ✅ OBTENER HORAS SEMANALES DINÁMICAMENTE
    let weekHours = 44; // valor por defecto
    if (startDate && endDate) {
      const sundayHoursConfig = await this.configurationService.findOneByName('HORAS_SEMANALES_DOMINGO');
      const weekHoursConfig = await this.configurationService.findOneByName('HORAS_SEMANALES');
      
      if (hasSundayReal && sundayHoursConfig?.value) {
        weekHours = parseInt(sundayHoursConfig.value, 10);
      } else if (!hasSundayReal && weekHoursConfig?.value) {
        weekHours = parseInt(weekHoursConfig.value, 10);
      }
    }

    // ✅ CÁLCULO CORRECTO DEL COMPENSATORIO
    const dayHours = weekHours / 6; // 7.333333 para 44 horas
    const compensatoryDay = dayHours / 6; // 1.222222 para 44 horas
    const compensatoryPerHour = compensatoryDay / dayHours; // compensatorio por hora
    
    // ✅ USAR DURACIÓN REAL DE LA OPERACIÓN, LIMITADA AL MÁXIMO DIARIO
    const effectiveHours = Math.min(opDuration, dayHours);
    const compensatoryHours = effectiveHours * compensatoryPerHour;


    const workerCount = billDB.number_of_workers ?? 0;
    const tariff = billDB.billDetails?.[0]?.operationWorker?.tariff?.paysheet_tariff ?? 0;

    const compensatoryAmount = compensatoryHours * workerCount * tariff;


    return {
      hours: compensatoryHours,
      amount: compensatoryAmount,
      percentage: compensatoryHours > 0 
        ? (compensatoryAmount / billDB.total_paysheet) * 100 
        : 0,
    };
  } catch (error) {
    console.error('Error en calculateCompensatoryForBill:', error);
    return {
      hours: 0,
      amount: 0,
      percentage: 0,
      error: 'Error al calcular compensatorio',
    };
  }
}

  // Preparar datos para servicio alternativo
  private prepareAlternativeServiceBillData(
    matchingGroupSummary: any,
    group: GroupBillDto,
    totalFacturation: number,
    totalPaysheet: number,
    operationId: number,
    userId: number,
  ) {
    const facturationUnit =
      matchingGroupSummary.facturation_unit ||
      matchingGroupSummary.unit_of_measure;
    const paysheetUnit = matchingGroupSummary.unit_of_measure;
    const week_number = matchingGroupSummary.dateRange.start
      ? getWeekNumber(new Date(matchingGroupSummary.dateRange.start))
      : 0;

    const paysheetTotalHours = group.paysheetHoursDistribution
      ? Object.values(group.paysheetHoursDistribution).reduce(
          (acc: number, hours: number) => acc + hours,
          0,
        )
      : 0;
    const billTotalHours = group.billHoursDistribution
      ? Object.values(group.billHoursDistribution).reduce(
          (acc: number, hours: number) => acc + hours,
          0,
        )
      : 0;

    const numberHours = paysheetTotalHours || billTotalHours || 0;

    return {
      week_number: week_number || 0,
      id_operation: operationId,
      id_user: userId,
      amount: group.amount || 0,
      number_of_workers: matchingGroupSummary.workers?.length || 0,
      total_bill: totalFacturation,
      total_paysheet: totalPaysheet,
      number_of_hours: numberHours,
      createdAt: new Date(),
      HED: group.paysheetHoursDistribution?.HED || 0,
      HON: group.paysheetHoursDistribution?.HON || 0,
      HOD: group.paysheetHoursDistribution?.HOD || 0,
      HEN: group.paysheetHoursDistribution?.HEN || 0,
      HFED: group.paysheetHoursDistribution?.HFED || 0,
      HFEN: group.paysheetHoursDistribution?.HFEN || 0,
      HFOD: group.paysheetHoursDistribution?.HFOD || 0,
      HFON: group.paysheetHoursDistribution?.HFON || 0,
      FAC_HED: group.billHoursDistribution?.HED || 0,
      FAC_HON: group.billHoursDistribution?.HON || 0,
      FAC_HOD: group.billHoursDistribution?.HOD || 0,
      FAC_HEN: group.billHoursDistribution?.HEN || 0,
      FAC_HFED: group.billHoursDistribution?.HFED || 0,
      FAC_HFEN: group.billHoursDistribution?.HFEN || 0,
      FAC_HFOD: group.billHoursDistribution?.HFOD || 0,
      FAC_HFON: group.billHoursDistribution?.HFON || 0,
      observation: group.observation || '',
      id_group: matchingGroupSummary.groupId,
    };
  }

  // Preparar datos para grupos por cantidad
  private prepareQuantityBillData(
    matchingGroupSummary: any,
    group: GroupBillDto,
    totalPaysheet: number,
    totalFacturation: number,
    operationId: number,
    userId: number,
  ) {
    const week_number = getWeekNumber(matchingGroupSummary.schedule?.dateStart);

    return {
      week_number: week_number || 0,
      id_operation: operationId,
      id_user: userId,
      amount: group.amount || 0,
      number_of_workers: matchingGroupSummary.workers?.length || 0,
      total_bill: totalFacturation,
      total_paysheet: totalPaysheet,
      number_of_hours: group.group_hours || 0,
      createdAt: new Date(),
      observation: group.observation || '',
      id_group: matchingGroupSummary.groupId,
    };
  }

  // Procesar detalles de facturación genérico
  private async processBillDetails(
    workers: any[],
    billId: number,
    operationId: number,
    groupDto: GroupBillDto,
    result: any,
  ) {
    for (const worker of workers || []) {
      const operationWorker = await this.findOperationWorker(
        worker.id,
        operationId,
        groupDto.id,
      );

      const totalPaysheetWorker = this.calculateTotalWorker(
        result.payroll.totalAmount,
        groupDto,
        worker,
        workers,
      );

      const totalFacturactionWorker = this.calculateTotalWorker(
        result.billing.totalAmount,
        groupDto,
        worker,
        workers,
      );

      const payWorker = groupDto.pays.find((p) => p.id_worker === worker.id);

      await this.createBillDetail({
        id_bill: billId,
        id_operation_worker: operationWorker.id,
        pay_rate: payWorker?.pay || 1,
        pay_unit: payWorker?.pay || 1,
        total_bill: totalFacturactionWorker,
        total_paysheet: totalPaysheetWorker,
      });
    }
  }

  // Procesar detalles para grupos HORAS
  private async processHoursBillDetails(
    workers: any[],
    billId: number,
    operationId: number,
    group: GroupBillDto,
    result: any,
  ) {
    for (const worker of workers) {
      const operationWorker = await this.findOperationWorker(
        worker.id,
        operationId,
        group.id,
      );
      const groupDto = this.getGroupDto([group], result.groupId);

      const totalPaysheetWorker = this.calculateTotalWorker(
        result.totalFinalPayroll,
        groupDto,
        worker,
        workers,
      );

      const totalFacturactionWorker = this.calculateTotalWorker(
        result.totalFinalFacturation,
        groupDto,
        worker,
        workers,
      );

      const payWorker = groupDto.pays.find((p) => p.id_worker === worker.id);

      await this.createBillDetail({
        id_bill: billId,
        id_operation_worker: operationWorker.id,
        pay_rate: payWorker?.pay || 1,
        pay_unit: payWorker?.pay || 1,
        total_bill: totalFacturactionWorker,
        total_paysheet: totalPaysheetWorker,
      });
    }
  }

  // Procesar detalles para servicio alternativo
  private async processAlternativeServiceBillDetails(
    workers: any[],
    billId: number,
    operationId: number,
    group: GroupBillDto,
    totalFacturation: number,
    totalPaysheet: number,
    matchingGroupSummary: any,
  ) {
    const facturationUnit =
      matchingGroupSummary.facturation_unit ||
      matchingGroupSummary.unit_of_measure;

    for (const worker of workers) {
      const operationWorker = await this.findOperationWorker(
        worker.id,
        operationId,
        group.id,
      );

      const totalPaysheetWorker = this.calculateTotalWorker(
        totalPaysheet,
        group,
        worker,
        workers,
      );

      const totalFacturactionWorker = this.calculateTotalWorker(
        totalFacturation,
        group,
        worker,
        workers,
      );

      const payWorker = group.pays?.find((p) => p.id_worker === worker.id);

      let payRate;
      if (facturationUnit !== 'HORAS' && facturationUnit !== 'JORNAL') {
        const totalUnitPays =
          group.pays?.reduce((sum, p) => sum + (p.pay || 0), 0) || 1;
        payRate = (group.amount / totalUnitPays) * (payWorker?.pay || 1);
      } else {
        payRate = payWorker?.pay || 1;
      }

      await this.createBillDetail({
        id_bill: billId,
        id_operation_worker: operationWorker.id,
        pay_rate: payRate,
        pay_unit: payWorker?.pay || 1,
        total_bill: totalFacturactionWorker,
        total_paysheet: totalPaysheetWorker,
      });
    }
  }

  // Procesar detalles para grupos por cantidad
  private async processQuantityBillDetails(
    workers: any[],
    billId: number,
    operationId: number,
    group: GroupBillDto,
    totalPaysheet: number,
    totalFacturation: number,
    matchingGroupSummary: any,
  ) {
    for (const worker of workers) {
      const operationWorker = await this.findOperationWorker(
        worker.id,
        operationId,
        group.id,
      );

      const totalUnitPays = group.pays.reduce(
        (sum, p) => sum + (p.pay || 0),
        0,
      );
      const payWorker = group.pays.find((p) => p.id_worker === worker.id);

      if (!payWorker) {
        throw new ConflictException(
          `No se encontró el pago para el trabajador con ID: ${worker.id}`,
        );
      }

      const payRate = (group.amount / totalUnitPays) * payWorker.pay;

      const totalWorkerPaysheet = this.calculateTotalWorker(
        totalPaysheet,
        group,
        worker,
        workers,
      );

      const totalWorkerFacturation = this.calculateTotalWorker(
        totalFacturation,
        group,
        worker,
        workers,
      );

      await this.createBillDetail({
        id_bill: billId,
        id_operation_worker: operationWorker.id,
        pay_rate: payRate,
        pay_unit: payWorker.pay || 1,
        total_bill: totalWorkerFacturation,
        total_paysheet: totalWorkerPaysheet,
      });
    }
  }

  // Funciones utilitarias reutilizables
// Funciones utilitarias reutilizables
  private async findOperationWorker(workerId: number, operationId: number, groupId?: string) {
    const whereClause: any = {
      id_worker: workerId,
      id_operation: operationId,
    };
    
    // ✅ CRÍTICO: Si se proporciona groupId, úsalo para diferenciar al mismo worker en diferentes grupos
    if (groupId) {
      whereClause.id_group = groupId;
      console.log(`🔍 [findOperationWorker] Buscando worker ${workerId} en grupo ${groupId}`);
    }
    
    const operationWorker = await this.prisma.operation_Worker.findFirst({
      where: whereClause,
      include: {
        tariff: {
          include: {
            subTask: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
            unitOfMeasure: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
      },
    });

    if (!operationWorker) {
      throw new ConflictException(
        `No se encontró el trabajador con ID: ${workerId} en operación ${operationId}${groupId ? ` y grupo ${groupId}` : ''}`,
      );
    }
    
    console.log(`✅ [findOperationWorker] Encontrado worker ${workerId}:`);
    console.log(`   - Tarifa ID: ${operationWorker.tariff?.id}`);
    console.log(`   - Subservicio: ${operationWorker.tariff?.subTask?.name} (${operationWorker.tariff?.subTask?.code})`);
    console.log(`   - Unidad: ${operationWorker.tariff?.unitOfMeasure?.name}`);

    return operationWorker;
  }

  private async createBillDetail(data: any) {
    return await this.prisma.billDetail.create({ data });
  }

  // Función auxiliar para calcular el total_paysheet de cada trabajador
  private calculateTotalWorker(
    totalGroup: number,
    group: GroupBillDto,
    worker: any,
    workers: any[],
  ) {
    let payUnits = 1;
    if (Array.isArray(group.pays) && group.pays.length > 0) {
      payUnits = group.pays.reduce((sum, p) => sum + (p.pay || 0), 0);
    } else if (workers?.length) {
      payUnits = workers.length;
    }


    const payObj = Array.isArray(group.pays)
      ? group.pays.find((p) => p.id_worker === worker.id)
      : null;
    const individualPayment = payObj?.pay ?? 1;

    const totalWorker = (totalGroup / payUnits) * individualPayment

    return totalWorker;
  }
  async findAll(id_site?: number, id_subsite?: number | null) {
     const whereClause: any = {};

    // Si viene id_site, filtrar por sitio
    if (id_site) {
      whereClause.operation = {
        id_site: id_site,
      };
    }

    // Solo filtrar por subsede si es un número válido (no null ni undefined)
    if (typeof id_subsite === 'number' && !isNaN(id_subsite)) {
      whereClause.operation = {
        ...(whereClause.operation || {}),
        id_subsite: id_subsite,
      };
    }
    const bills = await this.prisma.bill.findMany({
      where: whereClause,
      
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        operation: {
          select: {
            id: true,
            dateStart: true,
            dateEnd: true,
            timeStrat: true,
            timeEnd: true,
            op_duration: true,
            motorShip: true,
            client: {
              select: {
                id: true,
                name: true,
              },
            },
            jobArea: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        billDetails: {
          include: {
            operationWorker: {
              include: {
                worker: {
                  select: {
                    name: true,
                    dni: true,
                  },
                },
                tariff: {
                  include: {
                    subTask: {
                      select: {
                        id: true,
                        name: true,
                        code: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    // Calcular compensatorio para cada factura
    const billsWithCompensatory = await Promise.all(
      bills.map(async (bill) => {
        const compensatory = await this.calculateCompensatoryForBill(bill);
        return {
          ...bill,
          op_duration: bill.operation?.op_duration,
          compensatory,
        };
      }),
    );

    return billsWithCompensatory;
  }

  /**
   * Encuentra todas las bills filtradas por site y subsite
   * @param id_site - ID del site (opcional)
   * @param id_subsite - ID del subsite (opcional)
   * @returns Lista de bills filtradas con todas las relaciones
   */
  async findAllBySiteAndSubsite(id_site?: number, id_subsite?: number) {
    // Construir filtro dinámico basado en los parámetros
    const whereCondition: any = {};
    
    if (id_site !== undefined) {
      whereCondition.operation = {
        id_site: id_site,
      };
    }
    
    if (id_subsite !== undefined) {
      if (whereCondition.operation) {
        whereCondition.operation.id_subsite = id_subsite;
      } else {
        whereCondition.operation = {
          id_subsite: id_subsite,
        };
      }
    }

    const bills = await this.prisma.bill.findMany({
      where: whereCondition,
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        operation: {
          select: {
            id: true,
            dateStart: true,
            dateEnd: true,
            timeStrat: true,
            timeEnd: true,
            op_duration: true,
            motorShip: true,
            id_site: true,
            id_subsite: true,
            client: {
              select: {
                id: true,
                name: true,
              },
            },
            jobArea: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        billDetails: {
          include: {
            operationWorker: {
              include: {
                worker: {
                  select: {
                    name: true,
                    dni: true,
                  },
                },
                tariff: {
                  include: {
                    subTask: {
                      select: {
                        id: true,
                        code: true,
                        name: true,
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calcular compensatorio para cada factura
    const billsWithCompensatory = await Promise.all(
      bills.map(async (bill) => {
        const compensatory = await this.calculateCompensatoryForBill(bill);
        return {
          ...bill,
          op_duration: bill.operation?.op_duration,
          compensatory,
        };
      }),
    );

    return billsWithCompensatory;
  }

  async findOne(id: number, id_site?: number, id_subsite?: number | null) {
    const whereClause: any = {id};

    // Si viene id_site, filtrar por sitio
    if (id_site) {
      whereClause.operation = {
        id_site: id_site,
      };
    }

    // Solo filtrar por subsede si es un número válido (no null ni undefined)
    if (typeof id_subsite === 'number' && !isNaN(id_subsite)) {
      whereClause.operation = {
        ...(whereClause.operation || {}),
        id_subsite: id_subsite,
      };
    }
    const billDB = await this.prisma.bill.findUnique({
      where: whereClause,
      include: {
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        operation: {
          select: {
            id: true,
            dateStart: true,
            dateEnd: true,
            timeStrat: true,
            timeEnd: true,
            op_duration: true,
            motorShip: true,
            subSite: true,
            client: {
              select: {
                id: true,
                name: true,
              },
            },
            jobArea: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        },
        billDetails: {
          include: {
            operationWorker: {
              include: {
                worker: {
                  select: {
                    id: true,
                    name: true,
                    dni: true,
                  },
                },
                tariff: {
                  include: {
                    subTask: {
                      select: {
                        id: true,
                        name: true,
                        code: true,
                      },
                    },
                    
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!billDB) return null;

    // Calcular compensatorio
    const compensatory = await this.calculateCompensatoryForBill(billDB);
    // Mapeo para que la respuesta tenga la misma estructura que el DTO
    return {
      ...billDB,
      op_duration: billDB.operation?.op_duration,
      compensatory,
      billHoursDistribution: {
        HOD: billDB.HOD,
        HON: billDB.HON,
        HED: billDB.HED,
        HEN: billDB.HEN,
        HFOD: billDB.HFOD,
        HFON: billDB.HFON,
        HFED: billDB.HFED,
        HFEN: billDB.HFEN,
      },
      paysheetHoursDistribution: {
        HOD: billDB.FAC_HOD,
        HON: billDB.FAC_HON,
        HED: billDB.FAC_HED,
        HEN: billDB.FAC_HEN,
        HFOD: billDB.FAC_HFOD,
        HFON: billDB.FAC_HFON,
        HFED: billDB.FAC_HFED,
        HFEN: billDB.FAC_HFEN,
      },
      pays: billDB.billDetails.map((detail) => ({
        id_worker: detail.operationWorker.worker.id,
        pay: detail.pay_unit,
        pay_rate: detail.pay_rate,
      })),
    };
  }

  async update(id: number, updateBillDto: UpdateBillDto, userId: number) {
    console.log('Update Bill DTO:', JSON.stringify(updateBillDto, null, 2));
    const existingBill = await this.prisma.bill.findUnique({ where: { id } });
    if (!existingBill) {
      throw new ConflictException(`No se encontró la factura con ID: ${id}`);
    }

    const billDb = await this.prisma.bill.findUnique({
      where: { id },
    });

    if (!billDb) {
      throw new ConflictException(`No se encontró la factura con ID: ${id}`);
    }

    const validateOperationID = await this.validateOperation(
      billDb.id_operation,
    );

    if (validateOperationID['status'] === 404) {
      throw new ConflictException(
        `No se encontró la operación con ID: ${billDb.id_operation}`,
      );
    }

    this.validateUpdateGroups([updateBillDto]);

    const recalcularTotales = this.shouldRecalculateTotals([updateBillDto]);

    await this.updateBillFields(id, [updateBillDto], existingBill, userId);

    if (recalcularTotales) {
      await this.recalculateBillTotals(
        id,
        updateBillDto,
        validateOperationID,
        userId,
        billDb.id_operation,
        billDb.amount,
      );
    } else {
      await this.updateBillDetailsOnly(
        id,
        updateBillDto,
        validateOperationID,
        existingBill,
        billDb.id_operation,
      );
    }

    const billDB = await this.findOne(id);
    return billDB;
  }

  /**
   * Recalcula la factura completa después de cambiar op_duration
   * Se usa cuando se actualizan fechas de una operación COMPLETED
   */
  async recalculateBillAfterOpDurationChange(billId: number, operationId: number) {
    console.log(`[BillService] 🔄 Recalculando factura ${billId} por cambio en op_duration de operación ${operationId}`);
    
    try {
      // Obtener la factura actual con sus detalles
      const bill = await this.prisma.bill.findUnique({
        where: { id: billId },
        include: {
          billDetails: {
            include: {
              operationWorker: {
                include: {
                  worker: true,
                },
              },
            },
          },
        },
      });

      if (!bill) {
        throw new ConflictException(`No se encontró la factura con ID: ${billId}`);
      }

      // Obtener información actualizada de la operación con nuevo op_duration
      const validateOperationID = await this.validateOperation(operationId);
      
      if (validateOperationID['status'] === 404) {
        throw new ConflictException(`No se encontró la operación con ID: ${operationId}`);
      }

      console.log(`[BillService] ✅ op_duration actualizado: ${validateOperationID.op_duration} horas`);

      // ✅ PREPARAR DTO MÍNIMO CON DISTRIBUCIONES VACÍAS PARA FORZAR RECÁLCULO
      const updateBillDto: UpdateBillDto = {
        id: String(bill.id_group || ''),
        amount: 0, // ✅ Forzar recálculo desde cero
        group_hours: 0, // ✅ No usar, se calculará con op_duration del grupo
        billHoursDistribution: {
          HOD: 0,
          HON: 0,
          HED: 0,
          HEN: 0,
          HFOD: 0,
          HFON: 0,
          HFED: 0,
          HFEN: 0,
        },
        paysheetHoursDistribution: {
          HOD: 0,
          HON: 0,
          HED: 0,
          HEN: 0,
          HFOD: 0,
          HFON: 0,
          HFED: 0,
          HFEN: 0,
        },
        pays: bill.billDetails.map((detail) => ({
          id_worker: detail.operationWorker.worker.id,
          pay: 0, // ✅ Recalcular desde cero
        })),
      };

      console.log(`[BillService] 🔄 Recalculando con op_duration=${validateOperationID.op_duration} (distribuciones en cero para recálculo completo)`);

      // Recalcular totales con el nuevo op_duration propagado en validateOperationID
      await this.recalculateBillTotals(
        billId,
        updateBillDto,
        validateOperationID,
        bill.id_user,
        operationId,
        bill.amount,
      );

      console.log(`[BillService] ✅ Factura ${billId} recalculada con nuevo compensatorio`);
      
      return { success: true, message: 'Factura recalculada con nuevo compensatorio' };
    } catch (error) {
      console.error(`[BillService] ❌ Error recalculando factura ${billId}:`, error);
      throw error;
    }
  }

  async updateStatus(id: number, status: BillStatus, userId: number) {
    const existingBill = await this.prisma.bill.findUnique({ where: { id } });
    if (!existingBill) {
      throw new ConflictException(`No se encontró la factura con ID: ${id}`);
    }

    const updatedBill = await this.prisma.bill.update({
      where: { id },
      data: {
        status,
        updatedAt: new Date(),
        id_user: userId,
      },
    });

    return {
      id: updatedBill.id,
      status: updatedBill.status,
      message: `Estado de la factura actualizado a ${status}`,
    };
  }

  private validateUpdateGroups(groups: GroupBillDto[]) {
    if (!groups || groups.length === 0) {
      throw new ConflictException(
        'La operación no tiene grupos de trabajadores asignados.',
      );
    }
    for (const group of groups) {
      if (!group.pays || group.pays.length === 0) {
        throw new ConflictException(
          `El grupo con ID ${group} no tiene asignados pagos para los trabajadores.`,
        );
      }
    }
  }

  private shouldRecalculateTotals(groups: GroupBillDto[]): boolean {
    return groups.some(
      (group) =>
        group.billHoursDistribution ||
        group.paysheetHoursDistribution ||
        typeof group.amount !== 'undefined' ||
        typeof group.group_hours !== 'undefined',
    );
  }

  private async updateBillFields(
    id: number,
    groups: GroupBillDto[],
    existingBill: any,
    userId: number,
  ) {
    for (const group of groups) {
      const updateData: any = {
        updatedAt: new Date(),
        id_user: userId,
      };

      // Manejar observaciones
      if (group.observation !== undefined) {
        updateData.observation = group.observation;
      }

      // === AGREGAR ESTA LÍNEA PARA ACTUALIZAR AMOUNT ===
      if (typeof group.amount !== 'undefined') {
        updateData.amount = group.amount;
      }

      let finalNumberOfHours: number | undefined = undefined;

      // Procesar billHoursDistribution (FACTURACIÓN)
      if (group.billHoursDistribution) {
        // Calcular el total de horas de facturación
        const billTotalHours = Object.values(
          group.billHoursDistribution,
        ).reduce((acc: number, hours: number) => acc + (hours || 0), 0);

        Object.assign(updateData, {
          // billHoursDistribution va a las columnas CON prefijo FAC_ (FACTURACIÓN)
          FAC_HOD: group.billHoursDistribution.HOD ?? existingBill.FAC_HOD,
          FAC_HON: group.billHoursDistribution.HON ?? existingBill.FAC_HON,
          FAC_HED: group.billHoursDistribution.HED ?? existingBill.FAC_HED,
          FAC_HEN: group.billHoursDistribution.HEN ?? existingBill.FAC_HEN,
          FAC_HFOD: group.billHoursDistribution.HFOD ?? existingBill.FAC_HFOD,
          FAC_HFON: group.billHoursDistribution.HFON ?? existingBill.FAC_HFON,
          FAC_HFED: group.billHoursDistribution.HFED ?? existingBill.FAC_HFED,
          FAC_HFEN: group.billHoursDistribution.HFEN ?? existingBill.FAC_HFEN,
        });

        // Establecer las horas de facturación como prioritarias
        finalNumberOfHours = billTotalHours;
      }

      // Procesar paysheetHoursDistribution (NÓMINA)
      if (group.paysheetHoursDistribution) {
        Object.assign(updateData, {
          // paysheetHoursDistribution va a las columnas SIN prefijo FAC_ (NÓMINA)
          HOD: group.paysheetHoursDistribution.HOD ?? existingBill.HOD,
          HON: group.paysheetHoursDistribution.HON ?? existingBill.HON,
          HED: group.paysheetHoursDistribution.HED ?? existingBill.HED,
          HEN: group.paysheetHoursDistribution.HEN ?? existingBill.HEN,
          HFOD: group.paysheetHoursDistribution.HFOD ?? existingBill.HFOD,
          HFON: group.paysheetHoursDistribution.HFON ?? existingBill.HFON,
          HFED: group.paysheetHoursDistribution.HFED ?? existingBill.HFED,
          HFEN: group.paysheetHoursDistribution.HFEN ?? existingBill.HFEN,
        });

        // Solo usar las horas de paysheet si NO hay horas de facturación
        if (finalNumberOfHours === undefined) {
          const paysheetTotalHours = Object.values(
            group.paysheetHoursDistribution,
          ).reduce((acc: number, hours: number) => acc + (hours || 0), 0);
          finalNumberOfHours = paysheetTotalHours || finalNumberOfHours;
        }
      }

      // Aplicar el número de horas final
      if (finalNumberOfHours !== undefined) {
        updateData.number_of_hours = finalNumberOfHours;
      }

      console.log('Final number of hours:', finalNumberOfHours);
      console.log('Update data for bill:', updateData);

      await this.prisma.bill.update({
        where: { id },
        data: updateData,
      });
    }
  }
  private async recalculateBillTotals(
    id: number,
    group: UpdateBillDto,
    validateOperationID: any,
    userId: number,
    id_operation: number,
    amountDb: number,
  ) {
    let totalAmount = 0;
    let totalPaysheet = 0;
    let numberOfWorkers = 0;

    if (!group) {
      throw new ConflictException(
        'No se proporcionaron grupos para actualizar la factura.',
      );
    }

    const matchingGroupSummary = validateOperationID.workerGroups.find(
      (summary) => summary.groupId === group.id,
    );
    if (!matchingGroupSummary) {
      throw new ConflictException(
        `No se encontró el grupo con ID: ${group.id} en la operación.`,
      );
    }

    const { totalPaysheetGroup, totalFacturationGroup } =
      await this.calculateGroupTotalsForUpdate(
        matchingGroupSummary,
        group,
        amountDb,
      );

    totalAmount += totalFacturationGroup;
    totalPaysheet += totalPaysheetGroup;
    numberOfWorkers +=
      matchingGroupSummary.workers?.length || group.pays.length;

    await this.updateWorkerDetails(
      id,
      group,
      matchingGroupSummary,
      totalPaysheetGroup,
      totalFacturationGroup,
      id_operation,
    );

    await this.prisma.bill.update({
      where: { id },
      data: {
        total_bill: totalAmount,
        total_paysheet: totalPaysheet,
        number_of_workers: numberOfWorkers,
        updatedAt: new Date(),
        id_user: userId,
      },
    });
  }

  private async calculateGroupTotalsForUpdate(
    matchingGroupSummary: any,
    group: GroupBillDto,
    amountDb: number,
  ) {
    let totalPaysheetGroup = 0;
    let totalFacturationGroup = 0;

    // Agrega logs para depuración
    console.log('matchingGroupSummary:', matchingGroupSummary);
    console.log(
      'matchingGroupSummary.dateRange:',
      matchingGroupSummary?.dateRange,
    );
    //movio
    if (matchingGroupSummary.schedule.unit_of_measure === 'JORNAL') {
      matchingGroupSummary.paysheet_tariff =
        matchingGroupSummary.tariffDetails?.paysheet_tariff ?? 0;
      matchingGroupSummary.facturation_tariff =
        matchingGroupSummary.tariffDetails?.facturation_tariff ?? 0;
      matchingGroupSummary.agreed_hours =
        matchingGroupSummary.tariffDetails?.agreed_hours ?? 0;
      matchingGroupSummary.hours = matchingGroupSummary.tariffDetails?.hours ?? 0;
      matchingGroupSummary.workerCount =
        matchingGroupSummary.workers?.length || 0; // <-- Agrega esto

      const dateStart = matchingGroupSummary.schedule?.dateStart || new Date();

      const result = this.payrollCalculationService.processJornalGroups(
        [matchingGroupSummary],
        [group],
        dateStart,
      ).groupResults[0];

      totalPaysheetGroup = result?.payroll?.totalAmount || 0;
      totalFacturationGroup = result?.billing?.totalAmount || 0;
    } else if (
      matchingGroupSummary.schedule.unit_of_measure === 'HORAS' &&
      matchingGroupSummary.tariffDetails?.alternative_paid_service !== 'YES'
    ) {
// AGREGAR workerCount para grupos de HORAS
      matchingGroupSummary.workerCount =
        matchingGroupSummary.workers?.length || 0;
      
      console.log(`🔧 [calculateGroupTotalsForUpdate] HORAS - workerCount: ${matchingGroupSummary.workerCount}`);



      const result = await this.hoursCalculationService.processHoursGroups(
        matchingGroupSummary,
        group,
      );
      totalPaysheetGroup = result.totalFinalPayroll;
      totalFacturationGroup = result.totalFinalFacturation;
    } else if (
      matchingGroupSummary.tariffDetails?.alternative_paid_service === 'YES'
    ) {
      const { totalFacturation, totalPaysheet } =
        await this.calculateAlternativeServiceTotals(
          matchingGroupSummary,
          group,
        );
      totalPaysheetGroup = totalPaysheet;
      totalFacturationGroup = totalFacturation;
    } else {
      const { totalPaysheet, totalFacturation } = this.calculateQuantityTotals(
        matchingGroupSummary,
        group,
        amountDb,
      );
      totalPaysheetGroup = totalPaysheet;
      totalFacturationGroup = totalFacturation;
    }

    return { totalPaysheetGroup, totalFacturationGroup };
  }

  private async updateWorkerDetails(
    billId: number,
    group: GroupBillDto | UpdateBillDto,
    matchingGroupSummary: any,
    totalPaysheetGroup: number,
    totalFacturationGroup: number,
    operationId?: number,
  ){
     // ✅ CORRECCIÓN: Obtener los trabajadores del grupo desde la BD si pays está vacío o mal formado
    const operationWorkers = await this.prisma.operation_Worker.findMany({
      where: {
        id_operation: operationId,
        id_group: group.id,
      },
      include: {
        worker: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    console.log(`🔍 [updateWorkerDetails] Trabajadores encontrados en BD: ${operationWorkers.length}`);
    console.log(`🔍 [updateWorkerDetails] Pays recibidos: ${JSON.stringify(group.pays)}`);

    // ✅ Construir el array de pays correcto desde la BD y el DTO
    const validPays = operationWorkers.map(ow => {
      // Buscar si hay un pay específico en el DTO para este trabajador
      const payDto = Array.isArray(group.pays) 
        ? group.pays.find((p: any) => p?.id_worker === ow.id_worker)
        : null;
      
      return {
        id_worker: ow.id_worker,
        pay: payDto?.pay ?? 1, // Por defecto 1 si no viene en el DTO
      };
    });

    console.log(`✅ [updateWorkerDetails] Pays procesados: ${JSON.stringify(validPays)}`);

    // ✅ Iterar sobre los trabajadores reales de la BD
    for (const operationWorker of operationWorkers) {
      const billDetail = await this.prisma.billDetail.findFirst({
        where: {
          id_bill: billId,
          id_operation_worker: operationWorker.id,
        },
      });
      if (!billDetail) {
        console.warn(`⚠️ No se encontró billDetail para operation_worker ${operationWorker.id}`);
        continue;
      }

      // Obtener el pay de este trabajador desde el array procesado
      const workerPay = validPays.find(p => p.id_worker === operationWorker.id_worker);
      const payValue = workerPay?.pay ?? 1;

      console.log(`📊 [updateWorkerDetails] Worker ${operationWorker.id_worker} - pay: ${payValue}`);

      const totalWorkerPaysheet = this.calculateTotalWorker(
        totalPaysheetGroup,
        { ...group, pays: validPays }, // ✅ Usar pays procesados
        { id: operationWorker.id_worker },
        matchingGroupSummary.workers,
      );
      const totalWorkerFacturation = this.calculateTotalWorker(
        totalFacturationGroup,
        { ...group, pays: validPays }, // ✅ Usar pays procesados
        { id: operationWorker.id_worker },
        matchingGroupSummary.workers,
      );

      console.log(`💰 [updateWorkerDetails] Worker ${operationWorker.id_worker}:`);
      console.log(`   - Nómina: ${totalWorkerPaysheet}`);
      console.log(`   - Facturación: ${totalWorkerFacturation}`);

      // USAR la función calculatePayRateForWorker en lugar de lógica manual
      const payRate = this.calculatePayRateForWorker(
        matchingGroupSummary,
        { ...group, pays: validPays }, // ✅ Usar pays procesados
        validPays,
        Number(payValue),
        { amount: group.amount || 0 }, // existingBill simulado
      );

      await this.prisma.billDetail.update({
        where: { id: billDetail.id },
        data: {
          pay_rate: payRate,
          pay_unit: payValue,
          total_bill: totalWorkerFacturation,
          total_paysheet: totalWorkerPaysheet,
        },
      });

      console.log(`✅ [updateWorkerDetails] BillDetail ${billDetail.id} actualizado`);
    }
  }
  //  {
  //   for (const pay of group.pays) {
  //     const operationWorker = await this.prisma.operation_Worker.findFirst({
  //       where: {
  //         id_worker: pay.id_worker,
  //         id_operation: operationId || billId,
  //       },
  //     });
  //     if (!operationWorker) continue;

  //     const billDetail = await this.prisma.billDetail.findFirst({
  //       where: {
  //         id_bill: billId,
  //         id_operation_worker: operationWorker.id,
  //       },
  //     });
  //     if (!billDetail) continue;

  //     const totalWorkerPaysheet = this.calculateTotalWorker(
  //       totalPaysheetGroup,
  //       group,
  //       { id: pay.id_worker },
  //       matchingGroupSummary.workers,
  //     );
  //     const totalWorkerFacturation = this.calculateTotalWorker(
  //       totalFacturationGroup,
  //       group,
  //       { id: pay.id_worker },
  //       matchingGroupSummary.workers,
  //     );

  //     // Construir groupPay para el cálculo del pay_rate
  //     const groupPay = group.pays.map((p) => ({
  //       id_worker: p.id_worker,
  //       pay: p.pay,
  //     }));

  //     // USAR la función calculatePayRateForWorker en lugar de lógica manual
  //     const payRate = this.calculatePayRateForWorker(
  //       matchingGroupSummary,
  //       group,
  //       groupPay,
  //       Number(pay.pay),
  //       { amount: group.amount || 0 }, // existingBill simulado
  //     );

  //     await this.prisma.billDetail.update({
  //       where: { id: billDetail.id },
  //       data: {
  //         pay_rate: payRate,
  //         pay_unit: pay.pay ?? billDetail.pay_unit,
  //         total_bill: totalWorkerFacturation,
  //         total_paysheet: totalWorkerPaysheet,
  //       },
  //     });
  //   }
  // }


  private async updateBillDetailsOnly(
    id: number,
    updateBillDto: UpdateBillDto,
    validateOperationID: any,
    existingBill: any,
    id_operation: number,
  ) {
    if (!updateBillDto) {
      throw new ConflictException(
        'No se proporcionaron grupos para actualizar la factura.',
      );
    }
    for (const group of [updateBillDto]) {
      const matchingGroupSummary = validateOperationID.workerGroups.find(
        (summary) => summary.groupId === group.id,
      );
      if (!matchingGroupSummary) continue;

      const operationWorkers = await this.prisma.operation_Worker.findMany({
        where: {
          id_operation: id_operation ?? existingBill.id_operation,
          id_group: group.id,
        },
      });

      const billDetails = await this.prisma.billDetail.findMany({
        where: {
          id_bill: id,
          id_operation_worker: {
            in: operationWorkers.map((ow) => ow.id),
          },
        },
        include: {
          operationWorker: {
            include: {
              worker: {
                select: {
                  id: true,
                },
              },
            },
          },
        },
      });

      // Determinar el tipo de grupo y calcular totales
      const { totalPaysheetGroup, totalFacturationGroup } =
        await this.getExistingOrCalculateGroupTotals(
          matchingGroupSummary,
          group,
          existingBill,
          existingBill.amount,
        );

      // Construir pays actualizado para todos los trabajadores del grupo
      const groupPay = this.buildGroupPayArray(billDetails, group);

      // Actualizar detalles de cada trabajador
      await this.updateWorkersInGroup(
        id,
        operationWorkers,
        group,
        groupPay,
        matchingGroupSummary,
        totalPaysheetGroup,
        totalFacturationGroup,
        existingBill,
      );
    }
  }

  private async getExistingOrCalculateGroupTotals(
    matchingGroupSummary: any,
    group: GroupBillDto,
    existingBill: any,
    amountDb: number,
  ) {
    let totalPaysheetGroup = 0;
    let totalFacturationGroup = 0;

    const isHoursOrJornal =
      matchingGroupSummary.schedule?.unit_of_measure === 'JORNAL' ||
      matchingGroupSummary.schedule?.unit_of_measure === 'HORAS' ||
      matchingGroupSummary.schedule?.facturation_unit === 'JORNAL' ||
      matchingGroupSummary.schedule?.facturation_unit === 'HORAS';

    if (isHoursOrJornal) {
      // Usar totales existentes para grupos de horas/jornal sin recalcular
      totalPaysheetGroup = Number(existingBill.total_paysheet) || 0;
      totalFacturationGroup = Number(existingBill.total_bill) || 0;
    } else if (matchingGroupSummary.alternative_paid_service === 'YES') {
      // Recalcular para servicios alternativos
      const { totalFacturation, totalPaysheet } =
        await this.calculateAlternativeServiceTotals(
          matchingGroupSummary,
          group,
        );
      totalPaysheetGroup = totalPaysheet;
      totalFacturationGroup = totalFacturation;
    } else {
      // Recalcular para grupos por cantidad
      const { totalPaysheet, totalFacturation } = this.calculateQuantityTotals(
        matchingGroupSummary,
        group,
        amountDb,
      );
      totalPaysheetGroup = totalPaysheet;
      totalFacturationGroup = totalFacturation;
    }

    return { totalPaysheetGroup, totalFacturationGroup };
  }

  private buildGroupPayArray(billDetails: any[], group: GroupBillDto) {
    return billDetails.map((bd) => {
      const payDto = group.pays.find(
        (x) => x.id_worker === bd.operationWorker.worker.id,
      );
      let payValueWorker = payDto?.pay ?? (bd.pay_unit || 1); // Valor por defecto si no se encuentra el pago
      if (payValueWorker === null || payValueWorker === undefined) {
        payValueWorker = 1;
      }
      return {
        id_worker: bd.operationWorker.worker.id,
        pay: Number(payValueWorker),
      };
    });
  }

  private async updateWorkersInGroup(
    billId: number,
    operationWorkers: any[],
    group: GroupBillDto,
    groupPay: any[],
    matchingGroupSummary: any,
    totalPaysheetGroup: number,
    totalFacturationGroup: number,
    existingBill: any,
  ) {
    for (const operationWorker of operationWorkers) {
      const billDetail = await this.prisma.billDetail.findFirst({
        where: {
          id_bill: billId,
          id_operation_worker: operationWorker.id,
        },
      });
      if (!billDetail) continue;

      // Buscar el pago actualizado en el DTO
      const pay = group.pays.find(
        (p) => p.id_worker === operationWorker.id_worker,
      );
      const payValue = pay?.pay ?? billDetail.pay_unit;

      // Calcular subtotales por trabajador
      const totalWorkerPaysheet = this.calculateTotalWorker(
        totalPaysheetGroup,
        { ...group, pays: groupPay },
        { id: operationWorker.id_worker },
        matchingGroupSummary.workers,
      );
      const totalWorkerFacturation = this.calculateTotalWorker(
        totalFacturationGroup,
        { ...group, pays: groupPay },
        { id: operationWorker.id_worker },
        matchingGroupSummary.workers,
      );

      if (!payValue) {
        throw new ConflictException(
          `No se encontró el pago para el trabajador con ID: ${operationWorker.id_worker}`,
        );
      }

      // Calcular pay_rate según el tipo de grupo
      let payRate = this.calculatePayRateForWorker(
        matchingGroupSummary,
        group,
        groupPay,
        Number(payValue),
        existingBill,
      );

      await this.prisma.billDetail.update({
        where: { id: billDetail.id },
        data: {
          pay_rate: payRate,
          pay_unit: payValue,
          total_bill: totalWorkerFacturation,
          total_paysheet: totalWorkerPaysheet,
        },
      });
    }
  }

  private calculatePayRateForWorker(
    matchingGroupSummary: any,
    group: GroupBillDto | UpdateBillDto,
    groupPay: any[],
    payValue: number,
    existingBill: any,
  ): number {
    // Obtener datos del tariff
    const tariffDetails = matchingGroupSummary.tariffDetails;
    const scheduleUnitOfMeasure =
      matchingGroupSummary.schedule?.unit_of_measure;

    // Detectar servicio alternativo
    const isAlternativeService =
      tariffDetails?.alternative_paid_service === 'YES';

    // Detectar grupo de cantidad (no HORAS, no JORNAL, sin servicio alternativo)
    const isQuantityGroup =
      scheduleUnitOfMeasure !== 'HORAS' &&
      scheduleUnitOfMeasure !== 'JORNAL' &&
      !isAlternativeService &&
      !tariffDetails?.facturationUnit;

    // Detectar grupo de horas simples (HORAS sin servicio alternativo)
    const isSimpleHoursGroup =
      scheduleUnitOfMeasure === 'HORAS' && !isAlternativeService;

    // Detectar grupo jornal (JORNAL sin servicio alternativo)
    const isJornalGroup =
      scheduleUnitOfMeasure === 'JORNAL' && !isAlternativeService;

    if (isAlternativeService) {
      const facturationUnit =
        tariffDetails?.facturationUnit?.name ||
        matchingGroupSummary.facturation_unit ||
        scheduleUnitOfMeasure;

      if (facturationUnit !== 'HORAS' && facturationUnit !== 'JORNAL') {
        const totalUnitPays = groupPay.reduce(
          (sum, p) => sum + (p.pay || 0),
          0,
        );
        const safeAmount = Number(group.amount) || existingBill.amount || 0;
        const safeTotalUnidades = Number(totalUnitPays) || 1;
        const safePayValue =
          payValue !== null && payValue !== undefined ? Number(payValue) : 1;
        const result = (safeAmount / safeTotalUnidades) * safePayValue;

        return result;
      } else {
        // Para servicios alternativos con HORAS/JORNAL, usar payValue directamente

        return payValue;
      }
    } else if (isQuantityGroup) {
      const totalUnidades = groupPay.reduce((sum, p) => sum + (p.pay || 0), 0);
      const safeAmount = Number(group.amount) || existingBill.amount || 0;
      const safeTotalUnidades = Number(totalUnidades) || 1;
      const safePayValue =
        payValue !== null && payValue !== undefined ? Number(payValue) : 1;
      const result = (safeAmount / safeTotalUnidades) * safePayValue;
      return result;
    } else if (isSimpleHoursGroup || isJornalGroup) {
      // Para grupos de HORAS y JORNAL simples, pay_rate = payValue
      return payValue;
    }

    // Fallback: retornar payValue
    return payValue;
  }
  async remove(id: number) {
    return await this.prisma.bill.delete({
      where: { id },
    });
  }
}
