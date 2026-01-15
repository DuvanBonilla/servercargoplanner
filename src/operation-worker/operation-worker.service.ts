import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AssignWorkersDto } from './dto/assign-workers.dto';
import { WorkerScheduleDto } from './dto/worker-schedule.dto';
import { StatusComplete } from '@prisma/client';
import { RemoveWorkerFromOperationService } from './service/remove-worker-from-operation/remove-worker-from-operation.service';
import { UpdateWorkerSheduleService } from './service/update-worker-shedule/update-worker-shedule.service';
import { AssignWorkerToOperationService } from './service/assign-worker-to-operation/assign-worker-to-operation.service';

@Injectable()
export class OperationWorkerService {
  constructor(
    private prisma: PrismaService,
    private readonly removerWorkerFromOperationService: RemoveWorkerFromOperationService,
    private readonly updateWorkerSheduleService: UpdateWorkerSheduleService,
    private readonly assingWorkerToOperationService: AssignWorkerToOperationService,
  ) {}
  /**
   * Encuentra la programación de un trabajador específico en una operación
   * @param operationId - ID de la operación
   * @param workerId - ID del trabajador
   * @returns Registros de programación o array vacío si no existen
   */
  async findWorkerSchedule(operationId: number, workerId: number[]) {
    return await this.prisma.operation_Worker.findMany({
      where: {
        id_operation: operationId,
        id_worker: {
          in: workerId,
        },
      },
    });
  }

  /**
   * Asigna trabajadores a una operación
   * @param assignWorkersDto - Datos de asignación
   * @returns Resultado de la operación
   */
  async assignWorkersToOperation(
    assignWorkersDto: AssignWorkersDto,
    id_subsite?: number | null,
    id_site?: number | null,
  ) {
    return await this.assingWorkerToOperationService.assignWorkersToOperation(
      assignWorkersDto,
      id_subsite,
      id_site,
    );
  }
  /**
   * Cambiar estado de programacion cliente a COMPLETED
   * @param id_clientProgramming - ID de la programación del cliente
   * @returns Resultado de la actualización
   */
  async completeClientProgramming(id: number) {
    try {
      // Validar que la programación del cliente existe para extraer el ID clientProgramming
      const clientProgramming = await this.prisma.operation.findUnique({
        where: { id },
      });
      if (!clientProgramming) {
        return { message: 'Client programming not found', status: 404 };
      }
      const id_clientProgramming = clientProgramming.id_clientProgramming;

      if (id_clientProgramming === null) {
        return {
          message: 'Operation has no associated client programming',
          status: 400,
        };
      }

      const updateResult = await this.prisma.clientProgramming.update({
        where: { id: id_clientProgramming },
        data: {
          status: StatusComplete.COMPLETED,
        },
      });
      return updateResult;
    } catch (error) {
      console.error('Error completing client programming:', error);
      throw new Error(error.message);
    }
  }
  /**
   * Remueve trabajadores de una operación
   * @param removeWorkersDto - Datos de remoción
   * @returns Resultado de la operación
   */
  async removeWorkersFromOperation(removeWorkersDto: any) {
    return await this.removerWorkerFromOperationService.removeWorkersFromOperation(
      removeWorkersDto,
    );
  }
  /**
   *  Libera todos los trabajadores de una operación
   * @param id_operation
   * @returns Resultado de la liberación
   */
  async releaseAllWorkersFromOperation(id_operation: number) {
    return await this.removerWorkerFromOperationService.releaseAllWorkersFromOperation(
      id_operation,
    );
  }
  /**
   * Obtiene todos los trabajadores asignados a una operación
   * @param id_operation - ID de la operación
   * @returns Lista de trabajadores asignados
   */
  async getWorkersFromOperation(id_operation: number) {
    try {
      // Verificar que la operación existe
      const operation = await this.prisma.operation.findUnique({
        where: { id: id_operation },
      });

      if (!operation) {
        return { message: 'Operation not found', status: 404 };
      }

      // Obtener los trabajadores con detalles
      const operationWorkers = await this.prisma.operation_Worker.findMany({
        where: { id_operation },
        select: {
          worker: {
            select: {
              id: true,
              name: true,
              dni: true,
              status: true,
              phone: true,
            },
          },
        },
      });

      // Filtrar solo trabajadores con status AVALIABLE o ASSIGNED
      const workers = operationWorkers
        .map((ow) => ow.worker)
        .filter(
          (worker) =>
            worker.status === 'AVALIABLE' || worker.status === 'ASSIGNED',
        );
      return workers;
    } catch (error) {
      console.error('Error getting workers from operation:', error);
      throw new Error(error.message);
    }
  }
  /**
   * Actualiza la programación de trabajadores ya asignados a una operación
   * @param id_operation ID de la operación
   * @param workersToUpdate Array de trabajadores con su nueva programación
   * @returns Resultado de la actualización
   */
  async updateWorkersSchedule(
    id_operation: number,
    workersToUpdate: WorkerScheduleDto[],
    id_site?: number | null,
  ) {
    console.log('[OperationWorkerService] updateWorkersSchedule llamado con:');
    console.log('- id_operation:', id_operation);
    console.log('- workersToUpdate:', JSON.stringify(workersToUpdate, null, 2));

    // ✅ VERIFICAR QUE CADA WORKER TENGA id_subtask
    workersToUpdate.forEach((worker, index) => {
      console.log(`[OperationWorkerService] Worker ${index}:`, {
        id_group: worker.id_group,
        workerIds: worker.workerIds,
        id_task: worker.id_task,
        id_subtask: worker.id_subtask, // ✅ VERIFICAR QUE ESTÉ
        id_tariff: worker.id_tariff,
      });

      if (worker.id_subtask === undefined) {
        console.error(
          `[OperationWorkerService] ERROR: Worker ${index} no tiene id_subtask`,
        );
      }
    });

    // Llamar al servicio específico
    return await this.updateWorkerSheduleService.updateWorkersSchedule(
      id_operation,
      workersToUpdate,
      id_site,
    );
  }

  /**
   * Verifica si todos los grupos de una operación están completados
   * @param id_operation ID de la operación a verificar
   * @returns true si todos los grupos tienen dateEnd y timeEnd
   */
  private async areAllGroupsCompleted(id_operation: number): Promise<boolean> {
    // console.log(`[DEBUG] 🔍 Verificando si todos los grupos de operación ${id_operation} están completados...`);
    
    // Obtener todos los registros de operation_Worker para esta operación
    const allWorkers = await this.prisma.operation_Worker.findMany({
      where: {
        id_operation,
        id_worker: { not: -1 }, // Excluir placeholders
        id_group: { not: null }, // Excluir grupos nulos
      },
      select: {
        id_group: true,
        dateEnd: true,
        timeEnd: true,
        id_worker: true,
      },
    });

    
    if (allWorkers.length === 0) {
      return false;
    }

    // Agrupar por id_group y verificar que cada grupo tenga al menos un trabajador completado
    const groupsMap = new Map<string, any[]>();
    
    allWorkers.forEach(worker => {
      const groupId = worker.id_group;
      if (groupId !== null) { // Verificación adicional por seguridad
        if (!groupsMap.has(groupId)) {
          groupsMap.set(groupId, []);
        }
        groupsMap.get(groupId)!.push(worker);
      }
    });


    let allGroupsCompleted = true;
    
    for (const [groupId, workers] of groupsMap) {
      const completedWorkers = workers.filter(w => w.dateEnd !== null && w.timeEnd !== null);
      const incompleteWorkers = workers.filter(w => w.dateEnd === null || w.timeEnd === null);
      
      // console.log(`[DEBUG] 📊 Grupo ${groupId}:`);
      // console.log(`  - Total trabajadores: ${workers.length}`);
      // console.log(`  - Completados: ${completedWorkers.length}`);
      // console.log(`  - Incompletos: ${incompleteWorkers.length}`);
      
      if (incompleteWorkers.length > 0) {
        // console.log(`[DEBUG] ❌ Grupo ${groupId} NO está completado (${incompleteWorkers.length} trabajadores sin finalizar)`);
        // incompleteWorkers.forEach(w => {
        // //   console.log(`    - Worker ${w.id_worker}: dateEnd=${w.dateEnd}, timeEnd=${w.timeEnd}`);
        // });
        allGroupsCompleted = false;
      } 
      // else {
      //   console.log(`[DEBUG] ✅ Grupo ${groupId} está completado`);
      // }
    }

    // console.log(`[DEBUG] 🏁 Resultado final: ${allGroupsCompleted ? 'TODOS los grupos están completados' : 'AÚN hay grupos incompletos'}`);
    return allGroupsCompleted;
  }

  /**
   * Actualiza una operación a estado COMPLETED cuando todos los grupos están terminados
   * @param id_operation ID de la operación
   */
  private async completeOperationIfAllGroupsFinished(id_operation: number): Promise<void> {
    try {
      // Verificar si todos los grupos están completados
      const allCompleted = await this.areAllGroupsCompleted(id_operation);
      
      if (!allCompleted) {
        // console.log(`[OperationWorkerService] Operación ${id_operation}: No todos los grupos están completados aún`);
        return;
      }

      // console.log(`[OperationWorkerService] ✅ Todos los grupos de la operación ${id_operation} están completados. Actualizando a COMPLETED...`);

      // Obtener la operación actual para verificar estado
      const operation = await this.prisma.operation.findUnique({
        where: { id: id_operation },
        select: { 
          status: true, 
          dateStart: true, 
          timeStrat: true,
          dateEnd: true,
          timeEnd: true 
        },
      });

      if (!operation) {
        // console.error(`[OperationWorkerService] Operación ${id_operation} no encontrada`);
        return;
      }

      if (operation.status === 'COMPLETED') {
        // console.log(`[OperationWorkerService] Operación ${id_operation} ya está en estado COMPLETED`);
        return;
      }

      // 🆕 OBTENER LA FECHA MÁS RECIENTE DE FINALIZACIÓN DE TODOS LOS GRUPOS
      const latestGroupEnd = await this.getLatestGroupEndDateTime(id_operation);
      
      let opDuration = 0;
      let finalDateEnd = operation.dateEnd;
      let finalTimeEnd = operation.timeEnd;

      // Si encontramos una fecha de finalización más reciente, usarla
      if (latestGroupEnd) {
        finalDateEnd = latestGroupEnd.dateEnd;
        finalTimeEnd = latestGroupEnd.timeEnd;
        // console.log(`[OperationWorkerService] 🕐 Fecha de finalización más reciente: ${latestGroupEnd.dateEnd.toISOString()} ${latestGroupEnd.timeEnd}`);
      }

      // Calcular duración basándose en fecha de inicio y la fecha de finalización más reciente
      if (operation.dateStart && operation.timeStrat && finalDateEnd && finalTimeEnd) {
        const start = new Date(operation.dateStart);
        const [sh, sm] = operation.timeStrat.split(':').map(Number);
        start.setHours(sh, sm, 0, 0);

        const end = new Date(finalDateEnd);
        const [eh, em] = finalTimeEnd.split(':').map(Number);
        end.setHours(eh, em, 0, 0);

        const diffMs = end.getTime() - start.getTime();
        opDuration = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100; // 2 decimales
        opDuration = opDuration > 0 ? opDuration : 0;
        
        // console.log(`[OperationWorkerService] 📊 Duración calculada: ${opDuration} horas (inicio: ${start.toISOString()}, fin: ${end.toISOString()})`);
      }

      // Actualizar operación a COMPLETED con fecha/hora de finalización más reciente
      await this.prisma.operation.update({
        where: { id: id_operation },
        data: { 
          status: 'COMPLETED',
          dateEnd: finalDateEnd,
          timeEnd: finalTimeEnd,
          op_duration: opDuration
        },
      });

      // Liberar trabajadores (cambiar estado a AVAILABLE)
      await this.prisma.operation_Worker.findMany({
        where: { id_operation },
        select: { id_worker: true },
      }).then(async (operationWorkers) => {
        const workerIds = operationWorkers
          .map(ow => ow.id_worker)
          .filter(id => id !== -1); // Excluir placeholders

        if (workerIds.length > 0) {
          await this.prisma.worker.updateMany({
            where: {
              id: { in: workerIds },
              status: { not: 'AVALIABLE' },
            },
            data: { status: 'AVALIABLE' },
          });
          
          // console.log(`[OperationWorkerService] ✅ Liberados ${workerIds.length} trabajadores de la operación ${id_operation}`);
        }
      });

      // console.log(`[OperationWorkerService] ✅ Operación ${id_operation} completada exitosamente con duración: ${opDuration} horas, finalizada el ${finalDateEnd?.toISOString()} a las ${finalTimeEnd}`);
    } catch (error) {
      console.error(`[OperationWorkerService] Error al completar operación ${id_operation}:`, error);
    }
  }

  /**
   * Obtiene la fecha y hora de finalización más reciente entre todos los grupos completados
   * @param id_operation ID de la operación
   * @returns {dateEnd: Date, timeEnd: string} o null si no hay grupos completados
   */
  private async getLatestGroupEndDateTime(id_operation: number): Promise<{dateEnd: Date, timeEnd: string} | null> {
    try {
      // console.log(`[OperationWorkerService] 🔍 Buscando fecha más reciente de finalización para operación ${id_operation}...`);
      
      // Obtener todos los registros completados de la operación (con dateEnd y timeEnd)
      const completedWorkers = await this.prisma.operation_Worker.findMany({
        where: {
          id_operation,
          dateEnd: { not: null },
          timeEnd: { not: null },
          id_worker: { not: -1 }, // Excluir placeholders
        },
        select: {
          id_group: true,
          dateEnd: true,
          timeEnd: true,
        },
      });

      if (completedWorkers.length === 0) {
        // console.log(`[OperationWorkerService] ⚠️ No se encontraron grupos completados para operación ${id_operation}`);
        return null;
      }

      // Agrupar por id_group para obtener las fechas únicas de cada grupo
      const groupEndTimes = new Map<string, {dateEnd: Date, timeEnd: string}>();
      
      completedWorkers.forEach(worker => {
        const groupId = worker.id_group;
        if (groupId && worker.dateEnd && worker.timeEnd && !groupEndTimes.has(groupId)) {
          groupEndTimes.set(groupId, {
            dateEnd: worker.dateEnd,
            timeEnd: worker.timeEnd
          });
        }
      });

      // console.log(`[OperationWorkerService] 📊 Encontrados ${groupEndTimes.size} grupos completados:`);
      
      // Encontrar la fecha más reciente
      let latestDateTime: Date | null = null;
      let latestEndInfo: {dateEnd: Date, timeEnd: string} | null = null;

      groupEndTimes.forEach((endInfo, groupId) => {
        // Crear objeto Date completo para comparación
        const fullDateTime = new Date(endInfo.dateEnd);
        const [hours, minutes] = endInfo.timeEnd.split(':').map(Number);
        fullDateTime.setHours(hours, minutes, 0, 0);
        
        // console.log(`[OperationWorkerService]   - Grupo ${groupId}: ${endInfo.dateEnd.toISOString().split('T')[0]} ${endInfo.timeEnd} (${fullDateTime.toISOString()})`);

        if (!latestDateTime || fullDateTime > latestDateTime) {
          latestDateTime = fullDateTime;
          latestEndInfo = endInfo;
        }
      });

      if (latestEndInfo) {
        const endInfo = latestEndInfo as {dateEnd: Date, timeEnd: string};
        // console.log(`[OperationWorkerService] 🏆 Fecha más reciente: ${endInfo.dateEnd.toISOString().split('T')[0]} ${endInfo.timeEnd}`);
      }

      return latestEndInfo;
      
    } catch (error) {
      console.error(`[OperationWorkerService] Error obteniendo fecha más reciente para operación ${id_operation}:`, error);
      return null;
    }
  }

  async finalizeGroup(
    id_operation: number,
    id_group: number,
    dateEnd: Date,
    timeEnd: string,
  ) {
    console.log(`[OperationWorkerService] Finalizando grupo ${id_group} con fecha/hora: ${dateEnd.toISOString()} ${timeEnd}`);
    
    // 1. Actualizar el grupo con fecha y hora de finalización
    const updateResult = await this.prisma.operation_Worker.updateMany({
      where: {
        id_operation,
        id_group: id_group.toString(),
        dateEnd: null,
        timeEnd: null,
        id_worker: { not: -1 }, // ✅ EXCLUIR PLACEHOLDERS
      },
      data: {
        dateEnd,
        timeEnd,
      },
    });

    // 2. Verificar si todos los grupos están completados y actualizar operación si es necesario
    await this.completeOperationIfAllGroupsFinished(id_operation);

    return updateResult;
  }
}
