import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { StatusComplete } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ValidationService {
  constructor(private prisma: PrismaService) {}

  /**
   * Valida que todos los IDs proporcionados existan en la base de datos
   * @param params - Objeto con los IDs y valores a validar
   * @returns Objeto con resultado de la validación (success: true) o mensaje de error
   */
  async validateAllIds({
    id_user,
    id_area,
    id_task,
    id_subtask,
    id_costCenter,
    id_unidOfMeasure,
    id_client,
    id_operation,
    id_subsite,
    code_worker,
    payroll_code_worker,
    dni_worker,
    workerIds,
    allTaskIds,
    inChargedIds,
    phone_worker,
    code_tariff
  }: {
    id_user?: number;
    id_area?: number;
    id_task?: number;
    id_client?: number;
    id_subsite?: number;
    id_subtask?: number;
    code_tariff?: string;
    id_costCenter?: number;
    id_unidOfMeasure?: number;
    id_operation?: number;
    dni_worker?: string;
    code_worker?: string;
    payroll_code_worker?: string;
    phone_worker?: string;
    workerIds?: number[];
    allTaskIds?: number[];
    inChargedIds?: number[];
  }) {
    try {
      // 1. Validar usuario si se proporciona

      let response: any = { succes: true };
      if (id_user !== undefined) {
        const user = await this.prisma.user.findUnique({
          where: { id: id_user },
        });

        if (!user) {
          return { message: 'User not found', status: 404 };
        }
      }

      // 2. Validar área si se proporciona
      if (id_area !== undefined) {
        const area = await this.prisma.jobArea.findUnique({
          where: { id: id_area },
        });
        response.area = area;

        if (!area) {
          return { message: 'Area not found', status: 404 };
        }
      }

      // 3. Validar tarea si se proporciona
      if (id_task !== undefined && id_task !== null) {
        const task = await this.prisma.task.findUnique({
          where: { id: id_task },
        });

        if (!task) {
          return { message: 'Task not found', status: 404 };
        } else if (task) {
          response.task = task;
        }
      }

      // 4. Validar cliente si se proporciona
      if (id_client !== undefined) {
        const client = await this.prisma.client.findUnique({
          where: { id: id_client },
        });

        if (!client) {
          return { message: 'Client not found', status: 404 };
        }
      }

      // 5. Validar código si se proporciona
      if (code_worker !== undefined) {
        // Buscar todos los trabajadores con ese code
        const workersWithCode = await this.prisma.worker.findMany({
          where: { code: code_worker },
          select: { id: true, status: true, dni: true, name: true }
        });

        // Si existe algún trabajador que NO esté DEACTIVATED, bloquear
        const activeWorker = workersWithCode.find(w => w.status !== 'DEACTIVATED');
        if (activeWorker) {
          // console.log(
          //   `[ValidationService] ❌ ENCONTRADO trabajador activo con código:`,
          //   activeWorker.id, 'Status:', activeWorker.status, 'DNI:', activeWorker.dni
          // );
          return {
            message: `Code already exists and is assigned to DNI: ${activeWorker.dni || 'N/A'}`,
            status: 409
          };
        }

        // Si solo existen trabajadores DEACTIVATED, permitir reutilización y mostrar log
        if (workersWithCode.length > 0) {
          const deactivated = workersWithCode.map(w => `${w.dni || 'N/A'} (ID: ${w.id})`).join(', ');
          // console.log(`[ValidationService] Código ${code_worker} existe pero solo en trabajadores DEACTIVATED: ${deactivated}, permitiendo reutilización`);
        }

        // console.log(`[ValidationService] ✅ Código ${code_worker} está disponible para uso`);
      }

      // 6. Validar DNI si se proporciona
      if (dni_worker !== undefined) {
        // Buscar todos los trabajadores con ese DNI
        const workersWithDni = await this.prisma.worker.findMany({
          where: { dni: dni_worker },
          select: { id: true, status: true, dni: true, name: true }
        });

        // Si existe algún trabajador que NO esté DEACTIVATED, bloquear
        const activeWorker = workersWithDni.find(w => w.status !== 'DEACTIVATED');
        if (activeWorker) {
          // console.log(
          //   'Found existing worker with DNI:',
          //   activeWorker.id, 'Status:', activeWorker.status, 'DNI:', activeWorker.dni
          // );
          return {
            message: `Worker with this DNI already exists and is assigned to worker: ${activeWorker.name || 'N/A'} (ID: ${activeWorker.id})`,
            status: 409
          };
        }

        // Si solo existen trabajadores DEACTIVATED, permitir reutilización y mostrar log
        if (workersWithDni.length > 0) {
          const deactivated = workersWithDni.map(w => `${w.name || 'N/A'} (ID: ${w.id})`).join(', ');
          // console.log(`[ValidationService] DNI ${dni_worker} existe pero solo en trabajadores DEACTIVATED: ${deactivated}, permitiendo reutilización`);
        }
      }

      // 7. Validar teléfono si se proporciona
      if (phone_worker !== undefined) {
        const existingWorkerWithPhone = await this.prisma.worker.findFirst({
          where: { phone: phone_worker },
        });

        if (existingWorkerWithPhone) {
          // console.log(
          //   'Found existing worker with phone:',
          //   existingWorkerWithPhone.id,
          // );
          return { message: 'Phone already exists', status: 409 };
        }
      }

      // 8. Validar que todos los trabajadores existan si se proporcionan IDs
      if (workerIds && workerIds.length > 0) {
        // console.log('[ValidationService] IDs recibidos para validar:', workerIds);
        
        // FILTRAR valores undefined, null o inválidos antes de la consulta
        const validWorkerIds = workerIds
          .filter(id => {
            const isValid = id !== undefined && id !== null && !isNaN(Number(id)) && Number(id) > 0;
            if (!isValid) {
              console.warn('[ValidationService] ID inválido filtrado:', id);
            }
            return isValid;
          })
          .map(id => Number(id)); // Convertir a número
        
        // console.log('[ValidationService] IDs válidos para validar:', validWorkerIds);
        
        if (validWorkerIds.length > 0) {
          const existingWorkers = await this.prisma.worker.findMany({
            where: {
              id: {
                in: validWorkerIds  // Usar solo IDs válidos
              }
            },
            select: {
              id: true,
              id_site: true,
              id_subsite: true
            }
          });

          const existingWorkerIds = existingWorkers.map(w => w.id);
          const missingWorkerIds = validWorkerIds.filter(id => !existingWorkerIds.includes(id));

          if (missingWorkerIds.length > 0) {
            throw new NotFoundException(`Trabajadores no encontrados con IDs: ${missingWorkerIds.join(', ')}`);
          }

          // console.log('[ValidationService] Todos los trabajadores válidos existen');
        } else {
          if (workerIds.length > 0) {
            throw new BadRequestException('No se proporcionaron IDs de trabajadores válidos');
          }
          // console.log('[ValidationService] No hay IDs válidos de trabajadores para validar');
        }
      }

      // 9. Validar que todos los encargados existan si se proporcionan IDs
      if (inChargedIds && inChargedIds.length > 0) {
        const existingInCharged = await this.prisma.user.findMany({
          where: {
            id: {
              in: inChargedIds,
            },
          },
          select: {
            id: true,
          },
        });

        const existingInChargedIds = existingInCharged.map(
          (inChargedId) => inChargedId.id,
        );
        const nonExistingInChargedIds = inChargedIds.filter(
          (inChargedIds) => !existingInChargedIds.includes(inChargedIds),
        );

        if (nonExistingInChargedIds.length > 0) {
          return {
            message: `InCharged not found: ${nonExistingInChargedIds.join(', ')}`,
            status: 404,
          };
        }
      }

      // 10. Validar operación si se proporciona
      if (id_operation !== undefined) {
        const operation = await this.prisma.operation.findUnique({
          where: { id: id_operation },
        });
        if (operation) {
          response.operation = operation;
        }
        if (!operation) {
          return { message: 'Operation not found', status: 404 };
        }
      }

      // 11. Validar todas las tareas si se proporcionan IDs
      if (allTaskIds && allTaskIds.length > 0) {
        const existingTasks = await this.prisma.task.findMany({
          where: {
            id: {
              in: allTaskIds,
            },
          },
          select: {
            id: true,
            id_site: true,
            id_subsite: true,
            SubTask: { select: { id: true, name: true, id_task: true } },
          },
        });

        const existingTaskIds = existingTasks.map((task) => task.id);
        const existingTaskSitesAndSubsite = existingTasks.map((task) => ({
          id: task.id,
          id_site: task.id_site,
          id_subsite: task.id_subsite,
          subTask: task.SubTask,
        }));
        const nonExistingTaskIds = allTaskIds.filter(
          (taskId) => !existingTaskIds.includes(taskId),
        );

        if (nonExistingTaskIds.length > 0) {
          // console.log('Tasks not found:', nonExistingTaskIds);
          return {
            message: `Tasks not found: ${nonExistingTaskIds.join(', ')}`,
            status: 404,
          };
        }

        response.existingTaskIds = existingTaskSitesAndSubsite;
      }

      // 12. Validar subsite si se proporciona
      if (id_subsite !== undefined) {
        const subsite = await this.prisma.subSite.findUnique({
          where: { id: id_subsite },
        });

        if (!subsite) {
          return { message: 'Subsite not found', status: 404 };
        } else {
          response.subsite = subsite;
        }
      }

      //13. Validar subtarea si se proporciona
      if (id_subtask !== undefined) {
        const subtask = await this.prisma.subTask.findUnique({
          where: { id: id_subtask },
        });

        if (!subtask) {
          return { message: 'Subtask not found', status: 404 };
        } else {
          response.subtask = subtask;
        }
      }

      // 14. Validar centro de costo si se proporciona
      if (id_costCenter !== undefined) {
        const costCenter = await this.prisma.costCenter.findUnique({
          where: { id: id_costCenter },
        });

        if (!costCenter) {
          return { message: 'Cost center not found', status: 404 };
        } else {
          response.costCenter = costCenter;
        }
      }

      // 15. Validar unidad de medida si se proporciona
      if (id_unidOfMeasure !== undefined) {
        const unitOfMeasure = await this.prisma.unitOfMeasure.findUnique({
          where: { id: id_unidOfMeasure },
        });

        if (!unitOfMeasure) {
          return { message: 'Unit of measure not found', status: 404 };
        } else {
          response.unitOfMeasure = unitOfMeasure;
        }
      }

      //16. validar el codigo de nomina
      if (payroll_code_worker !== undefined && payroll_code_worker !== null && payroll_code_worker !== "") {
        // Buscar todos los trabajadores con ese payroll_code
        const workersWithPayrollCode = await this.prisma.worker.findMany({
          where: {
            payroll_code: payroll_code_worker
          },
          select: {
            id: true,
            status: true,
            dni: true,
            name: true
          }
        });

        // Si existe algún trabajador que NO esté DEACTIVATED, bloquear
        const activeWorker = workersWithPayrollCode.find(w => w.status !== 'DEACTIVATED');
        if (activeWorker) {
          // console.log(
          //   'Found existing worker with payroll code:',
          //   activeWorker.id, 'Status:', activeWorker.status, 'DNI:', activeWorker.dni
          // );
          return {
            message: `Payroll code already exists and is assigned to DNI: ${activeWorker.dni || 'N/A'}`,
            status: 409
          };
        }

        // Si solo existen trabajadores DEACTIVATED, permitir reutilización y mostrar log
        if (workersWithPayrollCode.length > 0) {
          const deactivated = workersWithPayrollCode.map(w => `${w.dni || 'N/A'} (ID: ${w.id})`).join(', ');
          // console.log(`[ValidationService] Código de nómina ${payroll_code_worker} existe pero solo en trabajadores DEACTIVATED: ${deactivated}, permitiendo reutilización`);
        }

        // console.log(`[ValidationService] ✅ Código de nómina ${payroll_code_worker} está disponible para uso`);
      }

      // 17. Validar código de tarifa si se proporciona
      if (code_tariff !== undefined) {
        const existingTarrifCode = await this.prisma.tariff.findUnique({
          where: { code: code_tariff },
        });

        if (existingTarrifCode) {
          return { message: 'Tariff code already exists', status: 409 };
        }
        
      }

      // console.log(`[ValidationService] ✅ Todas las validaciones completadas exitosamente - ValidationId: ${Math.random().toString(36).substring(7)}`);
      return response;
    } catch (error) {
      // console.error('Error validating IDs:', error);
      throw new Error(`Error validating IDs: ${error.message}`);
    }
  }


  /**
   * Validar si ya existe la programacion cliente
   * @param service_request - Solicitud de servicio
   * @param service - Servicio
   * @param dateStart - Fecha de inicio
   * @param timeStart - Hora de inicio
   * @param client - Cliente
   * @param ubication - Ubicación
   * @param id_operation - ID de la operación
   *
   */
  async validateClientProgramming({
    id_clientProgramming,
    // service_request,
    service,
    dateStart,
    timeStart,
    client,
    ubication,
    status,
  }: {
    id_clientProgramming?: number | null;
    service_request?: string;
    service?: string;
    dateStart?: string;
    timeStart?: string;
    client?: string;
    ubication?: string;
    status?: string;
  }) {
    try {
      // Verificar que la programación del cliente no exista
      if (
        // service_request &&
        service &&
        dateStart &&
        timeStart &&
        client &&
        ubication
      ) {
        const existingProgramming =
          await this.prisma.clientProgramming.findFirst({
            where: {
              // service_request,
              service,
              dateStart: new Date(dateStart || ''),
              timeStart,
              client,
              ubication,
            },
          });

        if (existingProgramming) {
          return {
            message: 'Client programming already exists',
            status: 409,
          };
        }
      }

      // if (service_request) {
      //   const serviceRequest = await this.prisma.clientProgramming.findFirst({
      //     where: { service_request },
      //   });
      //   if (serviceRequest) {
      //     return { message: 'Service alredy exists', status: 409 };
      //   }
      // }

      // verificar si existe y tiene estado asignado
      if (id_clientProgramming) {
        const validateId = await this.prisma.clientProgramming.findUnique({
          where: { id: id_clientProgramming },
        });
        if (!validateId) {
          return { message: 'Client programming not found', status: 404 };
        }
        const programming = await this.prisma.clientProgramming.findFirst({
          where: {
            id: id_clientProgramming,
            status: StatusComplete.ASSIGNED,
          },
        });
        if (programming) {
          return {
            message: 'Client programming already exists and is assigned',
            status: 409,
          };
        }
      }

      // Si no existe, se puede proceder con la creación
      return { success: true };
    } catch (error) {
      console.error('Error validating client programming:', error);
      throw new Error(`Error validating client programming: ${error.message}`);
    }
  }

  /**
   * Valida que un trabajador esté asignado a una operación
   * @param operationId - ID de la operación
   * @param workerId - ID del trabajador
   * @returns Objeto indicando si la relación existe o mensaje de error
   */
  async validateWorkerInOperation(operationId: number, workerId: number) {
    try {
      // console.log('Validating worker in operation:', { operationId, workerId });

      // Verificar que la operación existe
      const operation = await this.prisma.operation.findUnique({
        where: { id: operationId },
      });

      if (!operation) {
        // console.log('Operation not found:', operationId);
        return { message: 'Operation not found', status: 404 };
      }

      // Verificar que el trabajador existe
      const worker = await this.prisma.worker.findUnique({
        where: { id: workerId },
      });

      if (!worker) {
        // console.log('Worker not found:', workerId);
        return { message: 'Worker not found', status: 404 };
      }

      // Verificar la relación entre trabajador y operación
      const relation = await this.prisma.operation_Worker.findFirst({
        where: {
          id_operation: operationId,
          id_worker: workerId,
        },
      });

      if (!relation) {
        // console.log('Relation not found between operation and worker');
        return {
          message: `Worker ${workerId} is not assigned to operation ${operationId}`,
          status: 404,
        };
      }

      // console.log('Worker is assigned to operation');
      return { success: true };
    } catch (error) {
      console.error('Error validating worker in operation:', error);
      throw new Error(
        `Error validating worker-operation relation: ${error.message}`,
      );
    }
  }

  /**
   * Verifica si un código de trabajador ya existe (excluyendo trabajadores DEACTIVATED)
   * @param code - Código a verificar
   * @returns true si ya existe, false si no
   */
  async workerCodeExists(code: string): Promise<boolean> {
    try {
      const existingWorker = await this.prisma.worker.findFirst({
        where: { 
          code,
          status: {
            not: 'DEACTIVATED' // Solo considerar trabajadores que NO están DEACTIVATED
          }
        },
      });
      return !!existingWorker;
    } catch (error) {
      console.error('Error checking if worker code exists:', error);
      throw new Error(`Error checking worker code: ${error.message}`);
    }
  }

  /**
   * Verifica si un DNI de trabajador ya existe
   * @param dni - DNI a verificar
   * @returns true si ya existe, false si no
   */
  async workerDniExists(dni: string): Promise<boolean> {
    try {
      const existingWorker = await this.prisma.worker.findUnique({
        where: { dni },
      });
      return !!existingWorker;
    } catch (error) {
      console.error('Error checking if worker DNI exists:', error);
      throw new Error(`Error checking worker DNI: ${error.message}`);
    }
  }

  /**
   * Verifica si un teléfono de trabajador ya existe
   * @param phone - Teléfono a verificar
   * @returns true si ya existe, false si no
   */
  async workerPhoneExists(phone: string): Promise<boolean> {
    try {
      const existingWorker = await this.prisma.worker.findFirst({
        where: { phone },
      });
      return !!existingWorker;
    } catch (error) {
      console.error('Error checking if worker phone exists:', error);
      throw new Error(`Error checking worker phone: ${error.message}`);
    }
  }

  /**
   * Valida que un código no esté en uso por otro trabajador activo al actualizar
   * @param code - Código a verificar
   * @param workerId - ID del trabajador que se está actualizando (para excluirlo)
   * @returns true si el código está disponible, false si está en uso
   */
  async validateCodeForUpdate(code: string, workerId: number): Promise<{ available: boolean; message?: string }> {
    try {
      const existingWorker = await this.prisma.worker.findFirst({
        where: {
          code: code,
          status: {
            not: 'DEACTIVATED'
          },
          id: {
            not: workerId
          }
        }
      });

      if (existingWorker) {
        return {
          available: false,
          message: `Code ${code} is already in use by another active worker (ID: ${existingWorker.id})`
        };
      }

      return { available: true };
    } catch (error) {
      console.error('Error validating code for update:', error);
      throw new Error(`Error validating code: ${error.message}`);
    }
  }

  /**
   * Valida que un código de nómina no esté en uso por otro trabajador al actualizar
   * @param payrollCode - Código de nómina a verificar
   * @param workerId - ID del trabajador que se está actualizando (para excluirlo)
   * @returns true si el código está disponible, false si está en uso
   */
  async validatePayrollCodeForUpdate(payrollCode: string, workerId: number): Promise<{ available: boolean; message?: string }> {
    try {
      const existingWorker = await this.prisma.worker.findFirst({
        where: {
          payroll_code: payrollCode,
          id: {
            not: workerId
          }
          // El código de nómina debe ser único sin importar el estado del trabajador
        }
      });

      if (existingWorker) {
        return {
          available: false,
          message: `Payroll code ${payrollCode} is already in use by another worker (ID: ${existingWorker.id})`
        };
      }

      return { available: true };
    } catch (error) {
      console.error('Error validating payroll code for update:', error);
      throw new Error(`Error validating payroll code: ${error.message}`);
    }
  }
}
