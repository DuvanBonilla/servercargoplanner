import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigurationService } from 'src/configuration/configuration.service';
import { PrismaService } from 'src/prisma/prisma.service';
import { WorkerGroupSummary } from '../entities/worker-group-analysis.types';
import { GroupBillDto, HoursDistribution } from '../dto/create-bill.dto';
import { BaseCalculationService } from './base-calculation.service';

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

  async calculateCompensatoryHours(hours: number): Promise<number> {
    const weekHoursConfig = await this.configurationService.findOneByName('HORAS_SEMANALES');
    if (!weekHoursConfig) {
      throw new ConflictException('No configurations found');
    }

    const weekHours = weekHoursConfig.value ? parseInt(weekHoursConfig.value, 10) : 44;
    const dayHours = weekHours / 6;

    if (hours > dayHours) {
      throw new ConflictException('HOD + HON exceed daily hours limit');
    }

    const compensatoryHours = dayHours / 6 / (weekHours / 6);
    return compensatoryHours;
  }

  /**
   * Procesa grupos con unidad de medida HORAS
   */
  async processHoursGroups(
    groupSummary: WorkerGroupSummary,
    group: GroupBillDto,
    operationDate: Date | string | null,
  ) : Promise< ProcessHoursGroupsResult > {

      const combinedGroupData = {
        ...groupSummary,
        billHoursDistribution: group.billHoursDistribution,
        paysheetHoursDistribution: group.paysheetHoursDistribution,
        amount: group.amount,
        pays: group.pays,
      };


      const result = await this.calculateHoursGroupResult(combinedGroupData);
  

    return result;
  }

  private async calculateHoursGroupResult(combinedGroupData: any) {
    // Calcular horas totales
    const totalBillHours = combinedGroupData.billHoursDistribution.HOD + 
                          combinedGroupData.billHoursDistribution.HON;
    const totalPaysheetHours = combinedGroupData.paysheetHoursDistribution.HOD + 
                              combinedGroupData.paysheetHoursDistribution.HON;

    // Calcular horas compensatorias
    const compBill = await this.calculateCompensatoryHours(totalBillHours);
    const compPayroll = await this.calculateCompensatoryHours(totalPaysheetHours);

    // Calcular montos de distribución de horas
    const factHoursDistributionTotal = this.baseCalculationService.calculateHoursByDistribution(
      combinedGroupData,
      combinedGroupData.billHoursDistribution,
      combinedGroupData.facturation_tariff,
      true // usar multiplicadores FAC_
    );


    const paysheetHoursDistributionTotal = this.baseCalculationService.calculateHoursByDistribution(
      combinedGroupData,
      combinedGroupData.paysheetHoursDistribution,
      combinedGroupData.paysheet_tariff,
      false // usar multiplicadores normales
    );

    // Calcular montos compensatorios
    const totalCompBill = this.baseCalculationService.calculateCompensatoryAmount(
      compBill,
      combinedGroupData.workerCount,
      combinedGroupData.facturation_tariff,
      totalBillHours
    );

    const totalCompPayroll = this.baseCalculationService.calculateCompensatoryAmount(
      compPayroll,
      combinedGroupData.workerCount,
      combinedGroupData.paysheet_tariff,
      totalPaysheetHours
    );

    // Totales finales
    let totalFinalFacturation = factHoursDistributionTotal.totalAmount;
    if (combinedGroupData.compensatory === "YES") {
      totalFinalFacturation += totalCompBill;
    }
    if(combinedGroupData.full_tariff === "YES") {
      const sumHours =  (Object.values(combinedGroupData.billHoursDistribution) as number[]).reduce((a: number, b: number) => a + b, 0);
      totalFinalFacturation = combinedGroupData.facturation_tariff * sumHours * combinedGroupData.workerCount;
    }
    const totalFinalPayroll = paysheetHoursDistributionTotal.totalAmount + totalCompPayroll;

    return {
      groupId: combinedGroupData.groupId,
      site: combinedGroupData.site,
      subSite: combinedGroupData.subSite,
      task: combinedGroupData.task,
      code_tariff: combinedGroupData.code_tariff,
      tariff: combinedGroupData.tariff,
      workerCount: combinedGroupData.workerCount,
      totalFinalFacturation,
      totalFinalPayroll,
      week_number: combinedGroupData.week_number,
      details: {
        factHoursDistribution: factHoursDistributionTotal,
        paysheetHoursDistribution: paysheetHoursDistributionTotal,
        compensatoryBill: { hours: compBill, amount: totalCompBill },
        compensatoryPayroll: { hours: compPayroll, amount: totalCompPayroll },
      },
    };
  }

    public calculateAlternativeService(group: WorkerGroupSummary, groupBill: GroupBillDto) {
    // Nómina (paysheet)
    let paysheetTotal = 0;
    if (group.unit_of_measure !== 'HORAS' && group.unit_of_measure !== 'JORNAL') {
      // Por cantidad (ej: cajas, toneladas)
      paysheetTotal = (groupBill.amount || 0) * (group.paysheet_tariff || 0);
    } else {
      // Lógica tradicional
      paysheetTotal = this.baseCalculationService.calculateHoursByDistribution(
        group,
        groupBill.paysheetHoursDistribution,
        group.paysheet_tariff || 0,
        false
      ).totalAmount;
    }

  
    // Facturación
    let billingTotal = 0;
    if(group.group_tariff === "YES"){
      billingTotal = groupBill.group_hours * (group.facturation_tariff || 0);
    } else if (group.facturation_unit !== 'HORAS' && group.facturation_unit !== 'JORNAL') {
      billingTotal = (groupBill.amount || 0) * (group.facturation_tariff || 0);
    } else {
      billingTotal = this.baseCalculationService.calculateHoursByDistribution(
        group,
        groupBill.billHoursDistribution,
        group.facturation_tariff || 0,
        true
      ).totalAmount;
    }
  
    return {
      paysheetTotal,
      billingTotal
    };
  }
}