import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ValidationTaskAndSubtaskService {
  constructor(private prisma: PrismaService) {}
  /**
   * Valida que las SubTasks pertenezcan a las Tasks especificadas
   * @param taskSubTaskRelations - Array de objetos con id_task e id_subtask
   * @returns Validación de relaciones correctas
   */
  async validateTaskSubTaskRelations(
    taskSubTaskRelations: {
      id_task: number;
      id_subtask?: number;
      id_tariff: number;
    }[],
    id_site?: number | null,
  ) {
    try {
      if (!taskSubTaskRelations || taskSubTaskRelations.length === 0) {
        return { success: true };
      }

      // Obtener todas las tasks y tarifas involucradas
      const taskIds = [
        ...new Set(taskSubTaskRelations.map((rel) => rel.id_task)),
      ];
      const tariffIds = [
        ...new Set(taskSubTaskRelations.map((rel) => rel.id_tariff)),
      ];

      // Validar que todas las tasks existan con sus subtasks
      const existingTasks = await this.prisma.task.findMany({
        where: { id: { in: taskIds } },
        select: {
          id: true,
          id_site: true,
          id_subsite: true,
          SubTask: {
            select: { id: true, name: true, id_task: true },
          },
        },
      });

      // Obtener información de las tarifas (incluyendo subtask asociada)
      const existingTariffs = await this.prisma.tariff.findMany({
        where: { id: { in: tariffIds } },
        select: {
          id: true,
          id_subtask: true,
          id_costCenter: true,
          code: true,
          costCenter: {
            select: {
              id: true,
              name: true,
              id_subsite: true,
              subSite: {
                select: {
                  id_site: true,
                },
              },
            },
          },
          subTask: {
            select: {
              id: true,
              name: true,
              id_task: true,
            },
          },
        },
      });
      // 1. VALIDAR QUE LAS TASKS PERTENECEN AL SITE DE LA OPERACIÓN
      if (id_site) {
        const tasksWithDifferentSite = existingTasks.filter(
          (task) => task.id_site !== id_site,
        );

        if (tasksWithDifferentSite.length > 0) {
          const taskDetails = tasksWithDifferentSite.map((task) => ({
            taskId: task.id,
            taskSite: task.id_site,
            operationSite: id_site,
          }));

          return {
            message: 'All tasks must belong to the same Site as the operation',
            status: 400,
            details: `Found tasks from different Site: ${tasksWithDifferentSite.map((t) => t.id).join(', ')}`,
            taskSiteConflict: {
              id_site,
              taskDetails,
            },
          };
        }
      }

      // 2. VALIDAR QUE LAS TARIFAS PERTENECEN AL SITE DE LA OPERACIÓN
      if (id_site) {
        const tariffsWithDifferentSite = existingTariffs.filter(
          (tariff) => tariff.costCenter?.subSite?.id_site !== id_site,
        );

        if (tariffsWithDifferentSite.length > 0) {
          const tariffDetails = tariffsWithDifferentSite.map((tariff) => ({
            tariffId: tariff.id,
            tariffSite: tariff.costCenter?.subSite?.id_site,
            operationSite: id_site,
          }));

          return {
            message:
              'All tariffs must belong to the same Site as the operation',
            status: 400,
            details: `Found tariffs from different Site: ${tariffsWithDifferentSite.map((t) => t.id).join(', ')}`,
            tariffSiteConflict: {
              id_site,
              tariffDetails,
            },
          };
        }
      }

      // // 3. VALIDAR QUE TODAS LAS TASKS SON DEL MISMO SUBSITE
      // const taskSubSites = existingTasks.map((task) => task.id_subsite);
      
      // const uniqueSubSites = [...new Set(taskSubSites)];
      // if (uniqueSubSites.length > 1) {
      //   const taskDetails = existingTasks.map((task) => ({
      //     taskId: task.id,
      //     subSite: task.id_subsite,
      //   }));

      //   return {
      //     message: 'All tasks in an operation must belong to the same SubSite',
      //     status: 400,
      //     details: `Found tasks from ${uniqueSubSites.length} different SubSites: ${uniqueSubSites.join(', ')}`,
      //     taskSubSiteConflict: {
      //       foundSubSites: uniqueSubSites,
      //       taskDetails: taskDetails,
      //     },
      //   };
      // }

      // // 4. VALIDAR QUE TODAS LAS TARIFAS SON DEL MISMO SUBSITE
      // const tariffSubSites = existingTariffs.map(
      //   (tariff) => tariff.costCenter?.id_subsite,
      // );
      // const uniqueTariffSubSites = [...new Set(tariffSubSites.filter(Boolean))];

      // if (uniqueTariffSubSites.length > 1) {
      //   const tariffDetails = existingTariffs.map((tariff) => ({
      //     tariffId: tariff.id,
      //     subSite: tariff.costCenter?.id_subsite,
      //   }));

      //   return {
      //     message:
      //       'All tariffs in an operation must belong to the same SubSite',
      //     status: 400,
      //     details: `Found tariffs from ${uniqueTariffSubSites.length} different SubSites: ${uniqueTariffSubSites.join(', ')}`,
      //     tariffSubSiteConflict: {
      //       foundSubSites: uniqueTariffSubSites,
      //       tariffDetails: tariffDetails,
      //     },
      //   };
      // }

      // // 5. VALIDAR QUE EL SUBSITE DE LAS TAREAS Y TARIFAS SEA EL MISMO
      // if (
      //   uniqueSubSites.length > 0 &&
      //   uniqueTariffSubSites.length > 0 &&
      //   uniqueSubSites[0] !== uniqueTariffSubSites[0]
      // ) {
      //   return {
      //     message: 'Tasks and tariffs must belong to the same SubSite',
      //     status: 400,
      //     details: `Tasks are from SubSite ${uniqueSubSites[0]} but tariffs are from SubSite ${uniqueTariffSubSites[0]}`,
      //     mixedSubSiteConflict: {
      //       taskSubSite: uniqueSubSites[0],
      //       tariffSubSite: uniqueTariffSubSites[0],
      //     },
      //   };
      // }

      // 6. VALIDAR QUE LAS TARIFAS PERTENECEN A LA TAREA INDICADA
      // Crear un mapa de task -> subtasks para validación rápida
      const taskSubTaskMap = new Map();
      existingTasks.forEach((task) => {
        const subTaskIds = task.SubTask.map((st) => st.id);
        taskSubTaskMap.set(task.id, subTaskIds);
      });

      // Crear un mapa de tariff -> task para validación
      const tariffTaskMap = new Map();
      existingTariffs.forEach((tariff) => {
        if (tariff.subTask) {
          tariffTaskMap.set(tariff.id, tariff.subTask.id_task);
        }
      });

      // Validar que cada tarifa pertenece a la tarea indicada
      const invalidRelations: Array<{
        id_task: number;
        id_tariff: number;
        expected_task: number;
        actual_task: number | undefined;
      }> = [];

      taskSubTaskRelations.forEach((relation) => {
        const tariffTask = tariffTaskMap.get(relation.id_tariff);

        // Si la tarifa no tiene task asociada o no coincide con la indicada
        if (tariffTask === undefined || tariffTask !== relation.id_task) {
          invalidRelations.push({
            id_task: relation.id_task,
            id_tariff: relation.id_tariff,
            expected_task: relation.id_task,
            actual_task: tariffTask,
          });
        }
      });

      if (invalidRelations.length > 0) {
        return {
          message: 'Invalid Task-Tariff relations found',
          status: 400,
          invalidRelations: invalidRelations,
          details: invalidRelations.map(
            (ir) =>
              `Tariff ${ir.id_tariff} does not belong to Task ${ir.id_task}. It belongs to Task ${ir.actual_task || 'unknown'}.`,
          ),
        };
      }

      return {
        success: true,
        validatedRelations: taskSubTaskRelations,
        taskSubTaskMap: Object.fromEntries(taskSubTaskMap),
        // validatedSubSite: uniqueSubSites[0],
      };
    } catch (error) {
      console.error('Error validating Task-Tariff relations:', error);
      throw new Error(`Error validating relations: ${(error as Error).message}`);
    }
  }
}
