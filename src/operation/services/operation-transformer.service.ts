import { Injectable } from '@nestjs/common';
import { id } from 'date-fns/locale';

@Injectable()
export class OperationTransformerService {
  transformOperationResponse(operation) {
    if (!operation) return null;
    
    // ✅ AGREGAR LOG PARA VERIFICAR op_duration EN EL TRANSFORMADOR
  
    const { id_area, id_task, workers, inChargeOperation, ...rest } = operation;
    
    // ✅ VERIFICAR QUE op_duration ESTÉ EN rest
   // ✅ Ordenar workers por id_group y luego por id antes de transformar
    const sortedWorkers = workers?.sort((a, b) => {
      // Primero por grupo (null/undefined van al final)
      if (!a.id_group && !b.id_group) return a.id - b.id;
      if (!a.id_group) return 1;
      if (!b.id_group) return -1;
      
      const groupComparison = a.id_group.localeCompare(b.id_group);
      if (groupComparison !== 0) return groupComparison;
      
      // Si están en el mismo grupo, ordenar por ID (orden de creación)
      return a.id - b.id;
    });
    // Transformar trabajadores incluyendo el groupId
    const workersWithSchedule =
      sortedWorkers?.map((w) => {
        return ({
        id: w.id_worker,
        name: w.worker.name,
        dni: w.worker.dni,
        groupId: w.id_group, // Incluir el ID del grupo
        operationWorkerId: w.id, // Incluir el ID de la relación Operation_Worker
        observation: w.observation || null, // Incluir observación del registro Operation_Worker
        schedule: {
          dateStart: w.dateStart
            ? new Date(w.dateStart).toISOString().split('T')[0]
            : null,
          dateEnd: w.dateEnd
            ? new Date(w.dateEnd).toISOString().split('T')[0]
            : null,
          timeStart: w.timeStart || null,
          timeEnd: w.timeEnd || null,
          id_task: w.task ? w.task.id : null,
          task: w.task ? w.task.name : null,
          id_tariff: w.tariff ? w.tariff.id : null,
          tariff: w.tariff ? w.tariff.subTask.name : null,
          code_tariff: w.tariff ? w.tariff.code : null,
          id_unit_of_measure: w.tariff ? w.tariff.unitOfMeasure.id : null,
          unit_of_measure: w.tariff ? w.tariff.unitOfMeasure.name : null,
          facturation_unit: w.tariff ? w.tariff.facturationUnit?.name : null,
          id_facturation_unit: w.tariff ? w.tariff.facturationUnit?.id : null
        },
        subTask: w.SubTask ? {
          id: w.SubTask.id,
          name: w.SubTask.name,
          code: w.SubTask.code
        }
        : null,
      });
      }) || [];

    // ✅ PROCESAR ENCARGADOS CON FILTRADO DE DUPLICADOS
    let inCharge: any[] = [];
    
    if (operation.inChargeOperation && Array.isArray(operation.inChargeOperation)) {
      inCharge = this.removeDuplicateInCharge(operation.inChargeOperation);
    } else if (operation.inCharge && Array.isArray(operation.inCharge)) {
      inCharge = this.removeDuplicateInCharge(operation.inCharge);
    }

    const workerGroups =
      this.groupWorkersByScheduleAndGroup(workersWithSchedule);

    const result = {
      ...rest,
      workerGroups,
      inCharge, // ✅ USAR LOS ENCARGADOS ÚNICOS
      Bill: operation.Bill, // ✅ INCLUIR BILLS EN EL RESULTADO FINAL
      // Remover la relación intermedia
      inChargeOperation: undefined
    };

    // ✅ VERIFICAR QUE op_duration ESTÉ EN EL RESULTADO FINAL
    return result;
  }

  /**
   * Agrupa trabajadores por horario y ID de grupo
   */
  // groupWorkersByScheduleAndGroup(workers) {
  //   // Primero agrupar por ID de grupo
  //   const groupedByGroupId = {};

  //   workers.forEach((worker) => {
  //     const { groupId = 'default', ...workerData } = worker;

  //     if (!groupedByGroupId[groupId]) {
  //       groupedByGroupId[groupId] = {
  //         groupId,
  //         schedule: worker.schedule,
  //         subTask: worker.subTask,
  //         workers: [],
  //       };
  //     }

  //     groupedByGroupId[groupId].workers.push({
  //       id: workerData.id,
  //       name: workerData.name,
  //       dni: workerData.dni,
  //     });
  //   });

  //   // Convertir el objeto en array
  //   return Object.values(groupedByGroupId);
  // }
groupWorkersByScheduleAndGroup(workers) {
    // ✅ CAMBIO CRÍTICO: Agrupar por id_group + id_tariff para evitar mezclas
    const groupedByGroupId = {};

    workers.forEach((worker, index) => {
      const { groupId = 'default', operationWorkerId, ...workerData } = worker;
      
      // ✅ Crear clave única combinando groupId + tariff para evitar conflictos
      const tariffId = worker.schedule?.id_tariff || 'no-tariff';
      const uniqueKey = `${groupId}_${tariffId}`;

      if (!groupedByGroupId[uniqueKey]) {
        groupedByGroupId[uniqueKey] = {
          groupId: groupId, // ✅ Mantener el groupId original para el frontend
          schedule: worker.schedule, // ✅ Schedule específico de esta combinación
          subTask: worker.subTask,   // ✅ SubTask específico de esta combinación
          observation: worker.observation || null, // ✅ Observación del grupo
          workers: [],
          minOperationWorkerId: operationWorkerId, // ✅ ID mínimo para ordenamiento
        };
      } else {
        // ✅ Solo actualizar minOperationWorkerId si encontramos uno menor
        if (operationWorkerId < groupedByGroupId[uniqueKey].minOperationWorkerId) {
          groupedByGroupId[uniqueKey].minOperationWorkerId = operationWorkerId;
        }
      }

      groupedByGroupId[uniqueKey].workers.push({
        id: workerData.id,
        name: workerData.name,
        dni: workerData.dni,
      });
    });

    // ✅ MANTENER ORDEN POR ID DE OPERATION_WORKER (orden de creación en BD)
    const sortedGroups = Object.values(groupedByGroupId)
      .sort((a: any, b: any) => a.minOperationWorkerId - b.minOperationWorkerId);

    // ✅ FILTRAR GRUPOS VACÍOS (sin workers) antes de retornar
    return sortedGroups
      .filter((group: any) => group.workers && group.workers.length > 0)
      .map((group: any) => {
        // Eliminar campo auxiliar antes de retornar
        const { minOperationWorkerId, ...cleanGroup } = group;
        return cleanGroup;
      });
  }
  // ✅ AGREGAR MÉTODO PARA FILTRAR DUPLICADOS DE ENCARGADOS
  private removeDuplicateInCharge(inChargeData: any[]): any[] {
    if (!Array.isArray(inChargeData)) return [];
    
    // Usar Map para eliminar duplicados por ID de usuario
    const uniqueInCharge = new Map();
    
    inChargeData.forEach(item => {
      let userId, userData;
      
      // Manejar diferentes estructuras de datos
      if (item.user) {
        userId = item.user.id;
        userData = {
          id: item.user.id,
          name: item.user.name,
          occupation: item.user.occupation || null
        };
      } else if (item.id) {
        userId = item.id;
        userData = {
          id: item.id,
          name: item.name,
          occupation: item.occupation || null
        };
      }
      
      // Solo agregar si no existe ya
      if (userId && !uniqueInCharge.has(userId)) {
        uniqueInCharge.set(userId, userData);
      }
    });
    
    const result = Array.from(uniqueInCharge.values());
    // console.log('[OperationTransformer] inCharge originales:', inChargeData.length);
    // console.log('[OperationTransformer] inCharge únicos:', result.length);
    
    return result;
  }
}
