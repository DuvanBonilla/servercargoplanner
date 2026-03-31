import { Injectable } from '@nestjs/common';
import { WorkerScheduleDto } from 'src/operation-worker/dto/worker-schedule.dto';
import { OperationWorkerService } from 'src/operation-worker/operation-worker.service';
import { OperationInChargeService } from 'src/in-charged/in-charged.service';
import { UpdateOperationDto } from '../dto/update-operation.dto';
import { ValidationService } from 'src/common/validation/validation.service';
import { ValidationWorkerService } from 'src/common/validation/services/validation-worker/validation-worker.service';
import { ValidationClientProgrammingService } from 'src/common/validation/services/validation-client-programming/validation-client-programming.service';
import { ValidationTaskAndSubtaskService } from 'src/common/validation/services/validation-task-and-subtask/validation-task-and-subtask.service';

/**
 * Servicio para gestionar relaciones de operaciones
 */
@Injectable()
export class OperationRelationService {
  constructor(
    private operationWorkerService: OperationWorkerService,
    private operationInChargeService: OperationInChargeService,
    private validationService: ValidationService,
    private validationWaorkerService: ValidationWorkerService,
    private validationClientProgramming: ValidationClientProgrammingService,
    private validationTaskAndSubtaskService: ValidationTaskAndSubtaskService,
  ) {}

  /**
   * Asigna trabajadores y encargados a una operación
   * @param operationId - ID de la operación
   * @param workerIds - IDs de trabajadores simples
   * @param workersWithSchedule - Grupos de trabajadores programados
   * @param inChargedIds - IDs de encargados
   */
  async assignWorkersAndInCharge(
    operationId: number,
    workerIds: number[] = [],
    workersWithSchedule: WorkerScheduleDto[] = [],
    inChargedIds: number[] = [],
    id_subsite?: number | null,
    id_site?: number | null,
  ) {
    // Eliminar duplicados
    const uniqueWorkerIds = [...new Set(workerIds)];
    const uniqueInChargedIds = [...new Set(inChargedIds)];

    // Eliminar duplicados en los trabajadores con programación
    const uniqueWorkersWithSchedule: WorkerScheduleDto[] = [];

    // Procesar cada grupo de trabajadores con programación
    for (const schedule of workersWithSchedule) {
      if (schedule.workerIds && Array.isArray(schedule.workerIds)) {
        // Filtrar IDs duplicados dentro del mismo grupo
        const uniqueIds = [...new Set(schedule.workerIds)];

        // Agregar el grupo completo sin filtrar por apariciones en otros grupos
        uniqueWorkersWithSchedule.push({
          ...schedule,
          workerIds: uniqueIds,
        });
      }
    }

    const hasWorkers =
      uniqueWorkerIds.length > 0 || uniqueWorkersWithSchedule.length > 0;
    const hasInCharge = uniqueInChargedIds && uniqueInChargedIds.length > 0;

    // Asignar trabajadores
    if (hasWorkers) {
      const reponse =
        await this.operationWorkerService.assignWorkersToOperation(
          {
            id_operation: operationId,
            workerIds: uniqueWorkerIds,
            workersWithSchedule: uniqueWorkersWithSchedule,
          },
          null,
          id_site,
        );

      if (reponse && (reponse.status === 403 || reponse.status === 400)) {
        return reponse;
      }
    }

    // Asignar encargados
    if (hasInCharge) {
      await this.operationInChargeService.assignInChargeToOperation({
        id_operation: operationId,
        userIds: uniqueInChargedIds,
      });
    }
  }
  /**
   * Extrae los IDs de trabajadores de grupos programados
   * @param workersWithSchedule - Grupos de trabajadores programados
   * @returns Array de IDs de trabajadores
   */
  extractScheduledWorkerIds(
    workersWithSchedule: WorkerScheduleDto[] = [],
  ): number[] {
    const ids: number[] = [];

    if (!workersWithSchedule.length) return ids;

    workersWithSchedule.forEach((group) => {
      if (group.workerIds && Array.isArray(group.workerIds)) {
        ids.push(...group.workerIds);
      }
    });

    return ids;
  }

  /**
   * Valida los IDs para una operación
   * @param ids - Objeto con los IDs a validar
   * @returns Mensaje de error o null si todo es válido
   */
  async validateOperationIds(
    ids: any,
    workersWithSchedule: WorkerScheduleDto[] = [],
    id_site?: number | null,
  ) {
    const validation = await this.validationService.validateAllIds(ids);
    //validar todos los id_task por separado
    const allTaskIds = workersWithSchedule
      .map((group) => group.id_task)
      .filter((id) => id !== undefined);

    if (allTaskIds.length > 0) {
      // Construir las relaciones task-subtask desde workersWithSchedule
      const taskSubTaskRelations = workersWithSchedule
        .filter((worker) => worker.id_task && worker.id_tariff)
        .map((worker) => ({
          id_task: worker.id_task!,
          id_tariff: worker.id_tariff!,
        }));

      if (taskSubTaskRelations.length > 0) {
        const relationValidation =
          await this.validationTaskAndSubtaskService.validateTaskSubTaskRelations(
            taskSubTaskRelations,
            id_site,
          );

        if (relationValidation.status === 400) {
          return {
            message: relationValidation.message,
            status: 400,
            details: relationValidation.details,
            invalidRelations: relationValidation.invalidRelations,
          };
        }
      }
    }

    if (validation && 'status' in validation && validation.status === 404) {
      return validation;
    }

    return null;
  }
  /**
   *  Valida los IDs de trabajadores
   * @param workerIds
   * @returns
   */
  async validateWorkerIds(
    workerIds: number[],
    id_subsite?: number | null,
    id_site?: number | null,
  ) {
    if (!workerIds || !workerIds.length) return null;
    const validateWorkerIds =
      await this.validationWaorkerService.validateWorkerIds(
        workerIds,
        id_subsite,
        id_site,
      );

    if (validateWorkerIds?.status !== 200) {
      return validateWorkerIds;
    }
    return null;
  }

  /**
   * Valida los IDs de encargados en la actualización
   * @param updateDto - DTO de actualización
   * @returns Mensaje de error o null si es válido
   */
  async validateInChargedIds(updateDto: UpdateOperationDto) {
    if (!updateDto.inCharged?.connect?.length) return null;

    const inChargedIds = updateDto.inCharged.connect.map((item) => item.id);
    const validateIds = await this.validationService.validateAllIds({
      inChargedIds,
    });

    if (validateIds && 'status' in validateIds && validateIds.status === 404) {
      return validateIds;
    }

    return null;
  }

  /**
   * Validacion si la programcion cliente ya esta asignada
   * @param id_clientProgramming - ID de la programación del cliente
   */
  async validateClientProgramming(id_clientProgramming: number | null) {
    const validate =
      await this.validationClientProgramming.validateClientProgramming({
        id_clientProgramming,
      });

    if (
      (validate && 'status' in validate && validate.status === 409) ||
      validate.status === 404
    ) {
      return validate;
    }

    return null;
  }

  /**
   * Procesa las actualizaciones de relaciones (trabajadores y encargados)
   * @param operationId - ID de la operación
   * @param workers - Datos de actualización de trabajadores
   * @param inCharged - Datos de actualización de encargados
   */
  async processRelationUpdates(
    operationId: number,
    workers?: any,
    inCharged?: any,
    id_site?: number | null,
    id_subsite?: number | null,
  ) {
    //   console.log('processRelationUpdates:', {
    //   operationId,
    //   workers,
    //   inCharged,
    //   id_site,
    //   id_subsite,
    // });
    // Procesar actualizaciones de trabajadores
    if (workers) {
      const res = await this.processWorkerUpdates(
        operationId,
        workers,
        id_site,
        id_subsite,
      );
      if (
        (res.updated !== undefined || res.updated !== null) &&
        (res.updated?.status === 404 ||
          res.updated?.status === 400 ||
          res.updated?.status === 403)
      ) {
        return res;
      }
      if (res.status !== undefined && res.status !== 200) {
        return res;
      }
    }

    // Procesar actualizaciones de encargados
    if (inCharged) {
      await this.processInChargedUpdates(operationId, inCharged);
    }
  }

  /**
   * Procesa las actualizaciones de trabajadores
   * @param operationId - ID de la operación
   * @param workers - Datos de actualización de trabajadores
   * @returns Resultado de las operaciones
   */
  private async processWorkerUpdates(
  operationId: number,
  workers: any,
  id_site?: number | null,
  id_subsite?: number | null,
): Promise<any> {
  const results = {
    connected: null as any,
    disconnected: null as any,
    updated: null as any,
  };

  try {
    const currentWorkers = await this.operationWorkerService.getWorkersFromOperation(operationId);
console.log('Trabajadores actuales en BD:', currentWorkers);
    let currentWorkerIds: number[] = [];
    if (Array.isArray(currentWorkers)) {
      currentWorkerIds = currentWorkers.map(w => w.id);
    } else {
      console.error('Error al obtener trabajadores de la operación:', currentWorkers);
      return {
        error: currentWorkers.message || 'Error al obtener trabajadores',
        status: currentWorkers.status || 500,
      };
    }

    const { simpleWorkers, scheduledGroups } = this.separateWorkerTypes(workers.connect || []);
    const scheduledWorkerIds = scheduledGroups.flatMap(g => g.workerIds);
    const newWorkerIds = [...simpleWorkers, ...scheduledWorkerIds];

    // LOGS PARA DEPURAR
    console.log('Trabajadores actuales:', currentWorkerIds);
    console.log('Nuevos trabajadores:', newWorkerIds);

    const toRemove = currentWorkerIds.filter(id => !newWorkerIds.includes(id));
    const toAdd = newWorkerIds.filter(id => !currentWorkerIds.includes(id));

    // console.log('A eliminar:', toRemove);
    // console.log('A agregar:', toAdd);

    if (toRemove.length > 0) {
      results.disconnected = await this.operationWorkerService.removeWorkersFromOperation({
        id_operation: operationId,
        workersToRemove: toRemove,
      });
    }

    if (toAdd.length > 0) {
      const addSimple = toAdd.filter(id => simpleWorkers.includes(id));
      const addScheduled = scheduledGroups
        .map(group => ({
          ...group,
          workerIds: group.workerIds.filter(id => toAdd.includes(id)),
        }))
        .filter(group => group.workerIds.length > 0);

      if (addSimple.length > 0 || addScheduled.length > 0) {
        results.connected = await this.operationWorkerService.assignWorkersToOperation(
          {
            id_operation: operationId,
            workerIds: addSimple,
            workersWithSchedule: addScheduled,
          },
          id_subsite,
          id_site,
        );
      }
    }

    if (workers.update?.length) {
      results.updated = await this.operationWorkerService.updateWorkersSchedule(
        operationId,
        workers.update,
        id_site,
      );
    }

    return results;
  } catch (error) {
    console.error('Error processing worker updates:', error);
    return {
      error: error.message,
      status: 500,
    };
  }
}

  /**
   * Separa trabajadores en simples y programados
   * @param workers - Trabajadores a separar
   * @returns Objeto con trabajadores simples y programados
   */
  private separateWorkerTypes(workers: any[]) {
    const simpleWorkers: number[] = [];
    const scheduledGroups: WorkerScheduleDto[] = [];

    for (const item of workers) {
      if ('workerIds' in item && Array.isArray(item.workerIds)) {
        scheduledGroups.push({
          workerIds: item.workerIds,
          dateStart: item.dateStart,
          dateEnd: item.dateEnd,
          timeStart: item.timeStart,
          timeEnd: item.timeEnd,
          id_task: item.id_task,
          id_tariff: item.id_tariff,
          id_subtask: item.id_subtask,
        });
      } else if ('id' in item && typeof item.id === 'number') {
        simpleWorkers.push(item.id);
      }
    }

    return { simpleWorkers, scheduledGroups };
  }

  /**
   * Procesa las actualizaciones de encargados
   * @param operationId - ID de la operación
   * @param inCharged - Datos de actualización de encargados
   */
  private async processInChargedUpdates(operationId: number, inCharged: any) {
    // Conectar encargados
    if (inCharged.connect?.length) {
      const inChargedIds = inCharged.connect.map((item) => item.id);

      if (inChargedIds.length > 0) {
        await this.operationInChargeService.assignInChargeToOperation({
          id_operation: operationId,
          userIds: inChargedIds,
        });
      }
    }

    // Desconectar encargados
    if (inCharged.disconnect?.length) {
      const inChargedIds = inCharged.disconnect.map((item) => item.id);

      if (inChargedIds.length > 0) {
        await this.operationInChargeService.removeInChargeFromOperation({
          id_operation: operationId,
          userIds: inChargedIds,
        });
      }
    }
  }
}
