import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { StatusOperation } from '@prisma/client';

@Injectable()
export class UpdateWorkerService {
  private readonly logger = new Logger(UpdateWorkerService.name);

  constructor(private prisma: PrismaService) {}

  // async updateDisabledWorkers() {
  //   try {
  //     this.logger.debug('Checking for workers to update to AVALIABLE...');

  //     // Obtener la fecha actual sin la hora
  //     const now = new Date();
  //     const currentDate = new Date(
  //       now.getFullYear(),
  //       now.getMonth(),
  //       now.getDate(),
  //     );

  //     // Obtener la fecha de ayer para comparar con dateDisableEnd
  //     const yesterday = new Date(currentDate);
  //     yesterday.setDate(yesterday.getDate() - 1);

  //     this.logger.debug(
  //       `Current date: ${currentDate.toISOString()}, comparing with end dates <= ${yesterday.toISOString()}`,
  //     );

  //     // // Buscar trabajadores incapacitados cuya fecha de fin de incapacidad ya pasó (fue ayer o antes)
  //     // const disabledWorkers = await this.prisma.worker.findMany({
  //     //   where: {
  //     //     status: 'DISABLE',
  //     //     dateDisableEnd: {
  //     //       lte: yesterday, // Menor o igual que ayer (no hoy)
  //     //     },
  //     //   },
  //     // });

  //     this.logger.debug(`Found ${disabledWorkers.length} workers to update`);

  //     let updatedCount = 0;

  //     for (const worker of disabledWorkers) {
  //       this.logger.debug(
  //         `Updating worker ${worker.id} with disable end date: ${worker.dateDisableEnd}`,
  //       );

  //       // Actualizar estado a AVALIABLE
  //       await this.prisma.worker.update({
  //         where: { id: worker.id },
  //         data: {
  //           status: 'AVALIABLE',
  //           dateDisableStart: null,
  //           dateDisableEnd: null,
  //         },
  //       });
  //       updatedCount++;
  //     }

  //     if (updatedCount > 0) {
  //       this.logger.debug(
  //         `Updated ${updatedCount} workers from DISABLE to AVALIABLE status`,
  //       );
  //     }

  //     return { updatedCount };
  //   } catch (error) {
  //     this.logger.error('Error updating disabled workers:', error);
  //     throw error;
  //   }
  // }

  async updateWorkerFailures() {
    try {
      const workers = await this.prisma.worker.findMany();

      for (const worker of workers) {
        // this.logger.debug(`Updating worker ${worker.id} with failures: ${worker.failures}`,);

        await this.prisma.worker.update({
          where: { dni: worker.dni },
          data: {
            failures: 0,
          },
        });
      }
    } catch (error) {}
  }

  /**
   * Limpia operaciones canceladas o desactivadas después de X días
   * @param daysToKeep Número de días que se mantendrán las operaciones antes de eliminarlas
   */
  // async cleanupOldOperations(daysToKeep: number = 30) {
  //   try {
  //     const cutoffDate = new Date();
  //     cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

  //     // Buscar operaciones CANCELED o DEACTIVATED más antiguas que la fecha límite
  //     const operationsToDelete = await this.prisma.operation.findMany({
  //       where: {
  //         status: {
  //           in: [StatusOperation.CANCELED, StatusOperation.DEACTIVATED],
  //         },
  //         updateAt: { // Corregido: era 'updateAt'
  //           lt: cutoffDate,
  //         },
  //       },
  //       select: {
  //         id: true,
  //         status: true,
  //         updateAt: true, // Corregido: era 'updateAt'
  //       },
  //     });

  //     if (operationsToDelete.length === 0) {
  //       this.logger.log('No operations to cleanup');
  //       return { deletedCount: 0 };
  //     }

  //     let deletedCount = 0;
  //     let skippedCount = 0;

  //     // Procesar cada operación individualmente
  //     for (const operation of operationsToDelete) {
  //       try {
  //         const canDelete = await this.canOperationBeDeleted(operation.id);
  //         if (canDelete) {
  //           await this.cleanupSingleOperation(operation.id);
  //           deletedCount++;
  //           this.logger.log(
  //             `Deleted operation ${operation.id} with status ${operation.status}`,
  //           );
  //         } else {
  //           skippedCount++;
  //           this.logger.log(
  //             `Skipped operation ${operation.id} - has associated records (bills, feeding, or called attention)`,
  //           );
  //         }
  //       } catch (error) {
  //         this.logger.error(
  //           `Failed to delete operation ${operation.id}: ${error.message}`,
  //         );
  //       }
  //     }

  //     this.logger.log(`Cleanup completed. Deleted ${deletedCount} operations, skipped ${skippedCount} operations`);
  //     return { deletedCount, skippedCount };
  //   } catch (error) {
  //     this.logger.error('Error in cleanup operations:', error);
  //     throw error;
  //   }
  // }

  /**
   * Verifica si una operación puede ser eliminada (no tiene registros dependientes)
   */
  // private async canOperationBeDeleted(operationId: number): Promise<boolean> {
  //   try {
  //     // Verificar si tiene facturas (Bills)
  //     const billCount = await this.prisma.bill.count({
  //       where: { id_operation: operationId },
  //     });

  //     if (billCount > 0) {
  //       return false;
  //     }

  //     // Verificar si tiene registros de alimentación (Feeding)
  //     const feedingCount = await this.prisma.workerFeeding.count({
  //       where: { id_operation: operationId },
  //     });

  //     if (feedingCount > 0) {
  //       return false;
  //     }

  //     // // Verificar si tiene llamadas de atención (Called_Attention)
  //     // const calledAttentionCount = await this.prisma.calledAttention.count({
  //     //   where: { id_operation: operationId },
  //     // });

  //     // if (calledAttentionCount > 0) {
  //     //   return false;
  //     // }

  //     return true;
  //   } catch (error) {
  //     this.logger.error(`Error checking if operation ${operationId} can be deleted: ${error.message}`);
  //     return false;
  //   }
  // }

  /**
   * Limpia una operación individual y libera sus trabajadores si no están en otras operaciones
   */
//   private async cleanupSingleOperation(operationId: number) {
//   return await this.prisma.$transaction(async (prisma) => {
//     // 1. Obtener trabajadores asignados a la operación
//     const assignedWorkers = await prisma.operation_Worker.findMany({
//       where: { id_operation: operationId },
//       select: { id_worker: true },
//     });

//     const workerIds = assignedWorkers.map((ow) => ow.id_worker);

//     // 2. Eliminar registros de Operation_Worker de esta operación
//     await prisma.operation_Worker.deleteMany({
//       where: { id_operation: operationId },
//     });

//     // 3. Verificar cada trabajador si está en otras operaciones activas
//     let workersFreed = 0;
//     for (const workerId of workerIds) {
//       // Verificar si el trabajador está en otras operaciones activas
//       const otherOperations = await prisma.operation_Worker.findFirst({
//         where: {
//           id_worker: workerId,
//           operation: {
//             status: {
//               in: [
//                 StatusOperation.PENDING,
//                 StatusOperation.INPROGRESS,
//               ],
//             },
//           },
//         },
//       });

//       // Si no está en otras operaciones activas, cambiar a AVAILABLE
//       if (!otherOperations) {
//         await prisma.worker.update({
//           where: { id: workerId },
//           data: { status: 'AVALIABLE' },
//         });
//         workersFreed++;
//         this.logger.log(`Worker ${workerId} set to AVAILABLE`);
//       } else {
//         this.logger.log(`Worker ${workerId} still assigned to other operations`);
//       }
//     }

//     // 4. Eliminar la operación (ahora sin restricciones)
//     await prisma.operation.delete({
//       where: { id: operationId },
//     });

//     return {
//       operationId,
//       totalWorkers: workerIds.length,
//       workersFreed,
//     };
//   });
// }
}
