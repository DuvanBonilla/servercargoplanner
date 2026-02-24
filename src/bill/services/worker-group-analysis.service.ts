import { Injectable } from '@nestjs/common';
import {
  WorkerGroupSummary,
  WorkerGroupsAnalysis,
} from '../entities/worker-group-analysis.types';
import { getWeekNumber, hasSundayInRange } from 'src/common/utils/dateType';
import { ConfigurationService } from 'src/configuration/configuration.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class WorkerGroupAnalysisService {
  constructor(
    private configurationService: ConfigurationService,
    private prisma: PrismaService,
  ) {}

  /**
   * Obtiene la configuración de horas compensatorias según si hay domingo
   */
  async configurationCompensatory(
    startDate?: Date,
    endDate?: Date,
  ): Promise<number> {
    // Determinar si hay domingo en el rango
    const hasSunday =
      startDate && endDate ? hasSundayInRange(startDate, endDate) : false;

    // Obtener configuración apropiada
    const configName = hasSunday
      ? 'HORAS_SEMANALES_DOMINGO'
      : 'HORAS_SEMANALES';
    const configuration =
      await this.configurationService.findByName(configName);
    const hourSemanal =
      configuration && 'value' in configuration ? configuration.value : null;
    const hourSemanalInteger = hourSemanal
      ? parseInt(hourSemanal, 10)
      : hasSunday
        ? 48
        : 44;

    // Solo calcular compensatorio si NO hay domingo
    if (hasSunday) {
      console.log('No se calcula compensatorio para operaciones con domingo');
      return 0;
    }

    const valueCompensatory =
      hourSemanalInteger / 6 / 6 / (hourSemanalInteger / 6);
    return valueCompensatory;
  }

  /**
   * Analiza los grupos de trabajadores y genera un resumen por grupo
   */
  async summarizeWorkerGroups(
  workerGroups: any[],
): Promise<WorkerGroupSummary[]> {
  if (!workerGroups || !Array.isArray(workerGroups)) {
    return [];
  }

  return workerGroups.map((group) => {
    // Obtener fechas del grupo para el cálculo de compensatorio
    const startDate = group.schedule?.dateStart
      ? new Date(group.schedule.dateStart)
      : null;
    const endDate = group.schedule?.dateEnd
      ? new Date(group.schedule.dateEnd)
      : null;

    // // ✅ AGREGAR LOG PARA VERIFICAR op_duration
    // console.log('=== SUMMARY WORKER GROUP ===');
    // console.log('group.op_duration:', group.op_duration);
    // console.log('group structure keys:', Object.keys(group));

    return {
      groupId: group.groupId,
      site: group.tariffDetails?.costCenter?.subSite?.site?.name || null,
      subSite: group.tariffDetails?.costCenter?.subSite?.name || null,
      task: group.schedule?.task || 'No task assigned',
      id_unit_of_measure: group.schedule?.id_unit_of_measure || null,
      unit_of_measure: group.schedule?.unit_of_measure || null,
      code_tariff: group.schedule?.code_tariff || null,
      id_facturation_unit: group.tariffDetails?.facturationUnit?.id ?? null,
      facturation_unit: group.tariffDetails?.facturationUnit?.name ?? null,
      tariff: group.schedule?.tariff || null,
      id_tariff: group.schedule?.id_tariff || null,
      workerCount: group.workers?.length || 0,
      facturation_tariff: group.tariffDetails?.facturation_tariff,
      paysheet_tariff: group.tariffDetails?.paysheet_tariff,
      agreed_hours: group.tariffDetails?.agreed_hours,
      week_number: getWeekNumber(group.schedule?.dateStart) || undefined,
      full_tariff: group.tariffDetails?.full_tariff || false,
      compensatory: group.tariffDetails?.compensatory || false,
      alternative_paid_service:
        group.tariffDetails?.alternative_paid_service || false,
      group_tariff: group.tariffDetails?.group_tariff || false,
      settle_payment: group.tariffDetails?.settle_payment || false,
      hours: group.tariffDetails?.hours,
      op_duration: group.op_duration ?? null, // ✅ ASEGURAR QUE SE INCLUYA
      dateRange: {
        start: group.schedule?.dateStart || null,
        end: group.schedule?.dateEnd || null,
      },
      timeRange: {
        start: group.schedule?.timeStart || null,
        end: group.schedule?.timeEnd || null,
      },
      workers: group.workers || [],
    };
  });
}

  /**
   * Analiza completamente los grupos de trabajadores proporcionando estadísticas
   * @param workerGroups Grupos de trabajadores de una operación
   * @returns Análisis completo de grupos de trabajadores
   */
  async analyzeWorkerGroups(
    workerGroups: any[],
  ): Promise<WorkerGroupsAnalysis> {
    const groups = await this.summarizeWorkerGroups(workerGroups);

    // Calcular el total de trabajadores
    const totalWorkers = groups.reduce(
      (total, group) => total + group.workerCount,
      0,
    );

    // Obtener tareas únicas
    const uniqueTasks = [...new Set(groups.map((group) => group.task))].filter(
      Boolean,
    );

    return {
      totalGroups: groups.length,
      totalWorkers,
      groups,
      uniqueTasks,
    };
  }

  /**
   * Encuentra grupos con características específicas
   * @param workerGroups Grupos de trabajadores
   * @param criteria Criterios de búsqueda (ej: { unit_of_measure: 'JORNAL' })
   * @returns Grupos que cumplen con los criterios
   */
  async findGroupsByCriteria(
    workerGroups: any[],
    criteria: Partial<WorkerGroupSummary>,
  ): Promise<WorkerGroupSummary[]> {
    const groups = await this.summarizeWorkerGroups(workerGroups);

    return groups.filter((group) => {
      return Object.entries(criteria).every(([key, value]) => {
        // Manejar propiedades anidadas como dateRange.start
        if (key.includes('.')) {
          const [parentKey, childKey] = key.split('.');
          // Para strings, hacer comparación insensible a mayúsculas/minúsculas
          if (
            typeof value === 'string' &&
            group[parentKey] &&
            typeof group[parentKey][childKey] === 'string'
          ) {
            return (
              group[parentKey][childKey].toUpperCase() === value.toUpperCase()
            );
          }
          return group[parentKey] && group[parentKey][childKey] === value;
        }

        // Para strings, hacer comparación insensible a mayúsculas/minúsculas
        if (typeof value === 'string' && typeof group[key] === 'string') {
          return group[key].toUpperCase() === value.toUpperCase();
        }

        return group[key] === value;
      });
    });
  }
}
