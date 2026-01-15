import { Injectable } from '@nestjs/common';
import { ValidationTaskAndSubtaskService } from 'src/common/validation/services/validation-task-and-subtask/validation-task-and-subtask.service';
import { ValidationService } from 'src/common/validation/validation.service';
import { WorkerScheduleDto } from 'src/operation-worker/dto/worker-schedule.dto';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class UpdateWorkerSheduleService {
  constructor(
    private prisma: PrismaService,
    private validationTaskAndSubtaskService: ValidationTaskAndSubtaskService,
    private validationService: ValidationService,
  ) {}
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
    try {
      // console.log('[UpdateWorkerSheduleService] ===== INICIO ACTUALIZACIÓN =====');
      // console.log('[UpdateWorkerSheduleService] workersToUpdate:', JSON.stringify(workersToUpdate, null, 2));

      // Verificar específicamente id_subtask en cada grupo
      // workersToUpdate.forEach((group, index) => {
      //   console.log(`[UpdateWorkerSheduleService] Grupo ${index}:`);
      //   console.log(`  - id_group: ${group.id_group}`);
      //   console.log(`  - id_task: ${group.id_task}`);
      //   console.log(`  - id_subtask: ${group.id_subtask} (tipo: ${typeof group.id_subtask})`);
      //   console.log(`  - id_tariff: ${group.id_tariff}`);
      //   console.log(`  - workerIds: ${JSON.stringify(group.workerIds)}`);
      // });
      // Verificar que la operación existe
      const operation = await this.prisma.operation.findUnique({
        where: { id: id_operation },
      });

      if (!operation) {
        return { message: 'Operation not found', status: 404 };
      }

      const taskSubTaskRelations: {
        id_task: number;
        id_tariff: number;
      }[] = [];

      for (const worker of workersToUpdate || []) {
        if (worker.id_group) {
          // Obtener la información del grupo existente
          const relatedWorker = await this.prisma.operation_Worker.findFirst({
            where: {
              id_operation: id_operation,
              id_group: worker.id_group,
            },
          });

          if (relatedWorker) {
            // Solo llenar id_task si no se proporcionó en la solicitud
            if (!worker.id_task) {
              worker.id_task = relatedWorker.id_task ?? undefined;
            }

            // Solo llenar id_tariff si no se proporcionó en la solicitud
            if (!worker.id_tariff) {
              worker.id_tariff = relatedWorker.id_tariff ?? undefined;
            }
          }
        }

        if (worker.id_task && worker.id_tariff) {
          taskSubTaskRelations.push({
            id_task: worker.id_task,
            id_tariff: worker.id_tariff,
          });
        }
      }

      // Solo validar si hay relaciones task-subtask
      if (taskSubTaskRelations.length > 0) {
        const validationResult =
          await this.validationTaskAndSubtaskService.validateTaskSubTaskRelations(
            taskSubTaskRelations,
            id_site,
          );
        // Si la validación falla, retornar el error
        if (validationResult.status === 400) {
          return validationResult;
        }
      }
      // Contadores para el reporte final
      let groupsUpdated = 0;
      let totalWorkersUpdated = 0;

      // Por cada grupo de trabajadores a actualizar
      for (const group of workersToUpdate) {
        const {
          dateStart,
          timeStart,
          dateEnd,
          timeEnd,
          id_group,
          workerIds,
          id_task,
          id_subtask, 
          id_tariff,
        } = group;

        // console.log(`[UpdateWorkerSheduleService] ===== PROCESANDO GRUPO ${id_group} =====`);
        // console.log(`[UpdateWorkerSheduleService] Datos extraídos:`, {
        //   id_task,
        //   id_subtask, // ✅ LOG específico
        //   id_tariff,
        //   workerIds,
        // });

        // VALIDACIÓN CRÍTICA: Verificar que el id_group existe en la operación
        if (!id_group) {
          return {
            message: 'id_group es requerido para actualizar un grupo existente',
            status: 400,
          };
        }

        // Verificar que el grupo existe en la operación
        const existingGroupRecords =
          await this.prisma.operation_Worker.findMany({
            where: {
              id_operation,
              id_group: id_group,
            },
          });

        // ✅ AGREGAR al inicio del bucle principal:
        if (id_group && id_group.startsWith('temp_')) {
          // console.log(`[UpdateWorkerSheduleService] ⏭️ SALTANDO grupo temporal: ${id_group}`);
          continue;
        }

        // ✅ CAMBIAR la validación de grupo no encontrado:
        if (existingGroupRecords.length === 0) {
          // console.log(`[UpdateWorkerSheduleService] ⚠️ Grupo ${id_group} no encontrado, saltando...`);
          continue; // ✅ CAMBIAR return por continue
        }

        // NUEVO: Agregar trabajadores si se proporcionaron workerIds
        if (workerIds && workerIds.length > 0) {
          // Obtener trabajadores actuales del grupo
          const currentWorkerIds = existingGroupRecords.map(
            (record) => record.id_worker,
          );

          // Filtrar trabajadores nuevos (que no están en el grupo)
          const newWorkerIds = workerIds.filter(
            (id) => !currentWorkerIds.includes(id),
          );

          if (newWorkerIds.length > 0) {
            // Validar que los trabajadores existen
            const validation = await this.validationService.validateAllIds({
              workerIds: newWorkerIds,
            });
            if (
              validation &&
              'status' in validation &&
              validation.status === 404
            ) {
              return validation;
            }

            // Obtener configuración del primer registro del grupo para aplicar a los nuevos
            const groupConfig = existingGroupRecords[0];

            // Crear registros para los nuevos trabajadores
            const newWorkerRecords = newWorkerIds.map((workerId) => ({
              id_operation,
              id_worker: workerId,
              id_group: id_group,
              dateStart: groupConfig.dateStart,
              dateEnd: groupConfig.dateEnd,
              timeStart: groupConfig.timeStart,
              timeEnd: groupConfig.timeEnd,
              id_task: groupConfig.id_task,
              id_tariff: groupConfig.id_tariff,
              id_subtask: groupConfig.id_subtask,
            }));

            await this.prisma.operation_Worker.createMany({
              data: newWorkerRecords,
            });

            // Actualizar estado de trabajadores a ASSIGNED
            await this.prisma.worker.updateMany({
              where: { id: { in: newWorkerIds } },
              data: { status: 'ASSIGNED' },
            });

            // console.log(
            //   `Added ${newWorkerIds.length} new workers to group ${id_group}`,
            // );
          }
        }

        // ✅ PREPARAR DATOS DE ACTUALIZACIÓN INCLUYENDO id_subtask
        const updateData: any = {};

        // Solo incluir campos que se proporcionaron (evitar sobrescribir con undefined)
        if (dateStart !== undefined) {
          updateData.dateStart = dateStart ? new Date(dateStart) : null;
        }

        if (timeStart !== undefined) {
          updateData.timeStart = timeStart || null;
        }

        if (dateEnd !== undefined) {
          updateData.dateEnd = dateEnd ? new Date(dateEnd) : null;
        }

        if (timeEnd !== undefined) {
          updateData.timeEnd = timeEnd || null;
        }

        if (id_task !== undefined) {
          updateData.id_task = id_task || null;
          // console.log(`[UpdateWorkerSheduleService] Asignando id_task: ${id_task}`);
        }

        // ✅ PROCESAR id_subtask (REQUERIDO)
        if (id_subtask !== undefined) {
          updateData.id_subtask = id_subtask;
          // console.log(`[UpdateWorkerSheduleService] Asignando id_subtask: ${id_subtask}`);
        } else {
          console.error(`[UpdateWorkerSheduleService] ERROR: id_subtask no proporcionado para grupo ${id_group}`);
        }

        if (id_tariff !== undefined) {
          updateData.id_tariff = id_tariff || null;
          // console.log(`[UpdateWorkerSheduleService] Asignando id_tariff: ${id_tariff}`);
        }

        // console.log(`[UpdateWorkerSheduleService] ===== updateData FINAL =====`);
        // console.log(JSON.stringify(updateData, null, 2));

        // ✅ EJECUTAR ACTUALIZACIÓN
        const updateResult = await this.prisma.operation_Worker.updateMany({
          where: {
            id_operation,
            id_group: id_group,
          },
          data: updateData,
        });

        // console.log(`[UpdateWorkerSheduleService] Grupo ${id_group} actualizado. Registros afectados: ${updateResult.count}`);

        // ✅ VERIFICAR ACTUALIZACIÓN
        const verifyUpdate = await this.prisma.operation_Worker.findMany({
          where: {
            id_operation,
            id_group: id_group,
          },
          select: {
            id_worker: true,
            id_task: true,
            id_subtask: true,
            id_tariff: true,
            timeStart: true,
          },
        });

        // console.log(`[UpdateWorkerSheduleService] Verificación post-actualización:`, verifyUpdate);

        groupsUpdated++;
        totalWorkersUpdated += updateResult.count;
      }

      const result = {
        message: `Workers schedule updated successfully: ${groupsUpdated} groups updated, ${totalWorkersUpdated} workers affected`,
        groupsUpdated,
        totalWorkersUpdated,
      };

      // console.log('[UpdateWorkerSheduleService] ===== RESULTADO FINAL =====', result);
      return result;
    } catch (error) {
      console.error('[UpdateWorkerSheduleService] ERROR:', error);
      throw new Error(error.message);
    }
  }
}
