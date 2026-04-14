import { Injectable } from '@nestjs/common';
import { ValidationService } from '../../validation.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class ValidationWorkerService {
  constructor(
    private validationService: ValidationService,
    private readonly prisma: PrismaService,
  ) {}
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
    const validateIds = await this.validationService.validateAllIds({
      workerIds,
    });
    if (id_site && validateIds.existingWorkerIds) {
      const workersWithInvalidSite = validateIds.existingWorkerIds.filter(
        (worker) => worker.id_site !== id_site,
      );
      if (workersWithInvalidSite.length > 0) {
        const invalidWorkerIds = workersWithInvalidSite.map((w) => w.id);
        return {
          message: `Not access to workers with IDs site: ${invalidWorkerIds.join(
            ', ',
          )}`,
          status: 403,
        };
      }
    }
    return null;
  }

  /**
   * Valida que un trabajador esté asignado a una operación
   * @param operationId - ID de la operación
   * @param workerId - ID del trabajador
   * @returns Objeto indicando si la relación existe o mensaje de error
   */
  async validateWorkerInOperation(operationId: number, workerId: number) {
    try {
      console.log('Validating worker in operation:', { operationId, workerId });

      // Verificar que la operación existe
      const operation = await this.prisma.operation.findUnique({
        where: { id: operationId },
      });

      if (!operation) {
        console.log('Operation not found:', operationId);
        return { message: 'Operation not found', status: 404 };
      }

      // Verificar que el trabajador existe
      const worker = await this.prisma.worker.findUnique({
        where: { id: workerId },
      });

      if (!worker) {
        console.log('Worker not found:', workerId);
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
        console.log('Relation not found between operation and worker');
        return {
          message: `Worker ${workerId} is not assigned to operation ${operationId}`,
          status: 404,
        };
      }

      console.log('Worker is assigned to operation');
      return { success: true };
    } catch (error) {
      console.error('Error validating worker in operation:', error);
      throw new Error(
        `Error validating worker-operation relation: ${(error as Error).message}`,
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
      throw new Error(`Error checking worker code: ${(error as Error).message}`);
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
      throw new Error(`Error checking worker DNI: ${(error as Error).message}`);
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
      throw new Error(`Error checking worker phone: ${(error as Error).message}`);
    }
  }

  /**
   * Valida que todos los trabajadores existan y devuelve su información de site/subsite
   * @param workerIds - Array de IDs de trabajadores
   * @returns Información de trabajadores existentes o error si no existen
   */
  async validateWorkersExistence(workerIds: number[]) {
    try {
      if (!workerIds || workerIds.length === 0) {
        return { success: true, existingWorkerIds: [] };
      }

      // Obtener todos los trabajadores con su información de site/subsite
      const existingWorkers = await this.prisma.worker.findMany({
        where: {
          id: {
            in: workerIds,
          },
        },
        select: {
          id: true,
          id_site: true,
          id_subsite: true,
        },
      });

      const existingWorkerIds = existingWorkers.map((worker) => worker.id);
      const existingWorkerSitesAndSubsite = existingWorkers.map((worker) => ({
        id: worker.id,
        id_site: worker.id_site,
        id_subsite: worker.id_subsite,
      }));

      const nonExistingWorkerIds = workerIds.filter(
        (workerId) => !existingWorkerIds.includes(workerId),
      );

      // Si hay trabajadores que no existen, devolver error
      if (nonExistingWorkerIds.length > 0) {
        console.log('Workers not found:', nonExistingWorkerIds);
        return {
          message: `Workers not found: ${nonExistingWorkerIds.join(', ')}`,
          status: 404,
          nonExistingWorkers: nonExistingWorkerIds,
        };
      }

      // Devolver la información de los trabajadores existentes
      return {
        success: true,
        existingWorkerIds: existingWorkerSitesAndSubsite,
      };
    } catch (error) {
      console.error('Error validating workers existence:', error);
      throw new Error(`Error validating workers: ${(error as Error).message}`);
    }
  }
}
