import { Injectable } from '@nestjs/common';
import { ValidationWorkerService } from 'src/common/validation/services/validation-worker/validation-worker.service';
import { ValidationService } from 'src/common/validation/validation.service';
import { AssignWorkersDto } from 'src/operation-worker/dto/assign-workers.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class AssignWorkerToOperationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: ValidationService,
    private readonly validationWorkerService: ValidationWorkerService,
  ) {}
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
    try {
      const {
        id_operation,
        workerIds = [],
        workersWithSchedule = [],
      } = assignWorkersDto;

      // Si no hay trabajadores para asignar (ni simples ni con programación)
      if (workerIds.length === 0 && workersWithSchedule.length === 0) {
        return { message: 'No workers to assign', assignedWorkers: [] };
      }

      // 1. Recopilar todos los IDs de trabajadores para validación
      const allSimpleWorkerIds = [...workerIds];

      // Extraer todos los IDs de trabajadores de los grupos
      const allScheduledWorkerIds: number[] = [];
      workersWithSchedule.forEach((group) => {
        if (group.workerIds && Array.isArray(group.workerIds)) {
          allScheduledWorkerIds.push(...group.workerIds);
        }
      });

      // Combinar todos los IDs para validación
      const allWorkerIds = [...allSimpleWorkerIds, ...allScheduledWorkerIds];

      // Validar que todos los trabajadores existen
      if (allWorkerIds.length > 0) {
        const workerValidation = await this.validationService.validateAllIds({
          workerIds: allWorkerIds,
        });

        const validateWorkerIds =
          await this.validationWorkerService.validateWorkerIds(
            allWorkerIds,
            id_subsite,
            id_site,
          );
        if (validateWorkerIds?.status === 403) {
          return validateWorkerIds;
        }

        if (
          workerValidation &&
          'status' in workerValidation &&
          workerValidation.status === 404
        ) {
          return workerValidation;
        }
      }
      // Para los trabajadores programados, necesitamos filtrar por grupo
      const scheduledGroupsToProcess: typeof workersWithSchedule = [];

      workersWithSchedule.forEach((group) => {
        // Filtrar solo los IDs de trabajadores que no están asignados aún

        // Crear una copia del grupo con solo los trabajadores no asignados
        scheduledGroupsToProcess.push({
          ...group,
          workerIds: group.workerIds,
        });
      });

      // 5. Crear registros para trabajadores
      const assignmentPromises: Promise<any>[] = [];

      // Función para convertir fechas
      const parseDate = (dateString) => {
        if (!dateString) return null;
        return new Date(dateString);
      };

      // Asignar trabajadores simples (sin programación)
      if (allSimpleWorkerIds.length > 0) {
        const simpleAssignments = allSimpleWorkerIds.map((workerId) =>
          this.prisma.operation_Worker.create({
            data: {
              id_operation,
              id_worker: workerId,
              dateStart: null,
              dateEnd: null,
              timeStart: null,
              timeEnd: null,
            },
          }),
        );
        assignmentPromises.push(...simpleAssignments);
      }

      // Asignar grupos de trabajadores con la misma programación
      if (scheduledGroupsToProcess.length > 0) {
        // console.log(`[AssignWorkerService] 📋 Procesando ${scheduledGroupsToProcess.length} grupos`);
        
        // Para cada grupo de trabajadores con programación
        scheduledGroupsToProcess.forEach((group) => {
          const isNewGroup = !group.id_group;
          const isExistingGroup = !!group.id_group;
          
          // Generar UUID para grupos nuevos (1 o más workers), usar id_group si existe
          const groupId = isNewGroup ? uuidv4() : group.id_group;
          
          if (isNewGroup) {
            // console.log(`[AssignWorkerService] 🆕 Creando nuevo grupo: ${groupId} (${group.workerIds.length} workers)`);
          } else if (isExistingGroup) {
            // console.log(`[AssignWorkerService] ♻️ Agregando a grupo existente: ${groupId} (${group.workerIds.length} workers)`);
          }
          
          const groupSchedule = {
            dateStart: group.dateStart ? parseDate(group.dateStart) : null,
            dateEnd: group.dateEnd ? parseDate(group.dateEnd) : null,
            timeStart: group.timeStart || null,
            timeEnd: group.timeEnd || null,
            ...(groupId && { id_group: groupId }), // Solo incluir si hay groupId
            id_task: group.id_task || null,
            id_tariff: group.id_tariff || null,
            id_subtask: group.id_subtask || null,
            observation: group.observation || null,
          };

          // Crear una promesa de creación para cada trabajador en el grupo
          const groupAssignments = group.workerIds.map((workerId) =>
            this.prisma.operation_Worker.create({
              data: {
                id_operation,
                id_worker: workerId,
                ...groupSchedule,
              },
            }),
          );

          assignmentPromises.push(...groupAssignments);
        });
      }

      // Ejecutar todas las asignaciones
      await Promise.all(assignmentPromises);

      // 6. Actualizar estado de los trabajadores asignados
      const allWorkersToUpdate = [
        ...allSimpleWorkerIds,
        ...scheduledGroupsToProcess.flatMap((g) => g.workerIds),
      ];

      if (allWorkersToUpdate.length > 0) {
        await this.prisma.worker.updateMany({
          where: { id: { in: allWorkersToUpdate } },
          data: { status: 'ASSIGNED' },
        });
      }

      // 7. Generar respuesta
      return {
        message: `${allWorkersToUpdate.length} workers assigned to operation ${id_operation}`,
        assignedWorkers: {
          simple: allSimpleWorkerIds,
          scheduled: scheduledGroupsToProcess,
        },
      };
    } catch (error) {
      console.error('Error assigning workers to operation:', error);
      throw new Error((error as Error).message);
    }
  }
}
