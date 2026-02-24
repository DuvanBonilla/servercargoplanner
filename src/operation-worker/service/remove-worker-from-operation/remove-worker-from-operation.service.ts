import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { getColombianDateTime, getColombianTimeString } from 'src/common/utils/dateColombia';
import { ValidationService } from 'src/common/validation/validation.service';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class RemoveWorkerFromOperationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validationService: ValidationService,
  ) {}

  /**
   * Remueve trabajadores de una operación
   * @param removeWorkersDto - Datos de remoción
   * @returns Resultado de la operación
   */
  async removeWorkersFromOperation(removeWorkersDto: any) {
    try {
      const { id_operation, workerIds, workersToRemove } = removeWorkersDto;

      // CASO 1: Formato original (compatibilidad hacia atrás)
      if (workerIds && workerIds.length > 0) {
        // Validar que todos los trabajadores existen
        const workerValidation = await this.validationService.validateAllIds({
          workerIds,
        });

        if (
          workerValidation &&
          'status' in workerValidation &&
          workerValidation.status === 404
        ) {
          return workerValidation;
        }

        // Eliminar de toda la operación (comportamiento original)
        // ✅ APLICAR ELIMINACIÓN EN CASCADA
        const operationWorkersToDelete = await this.prisma.operation_Worker.findMany({
          where: {
            id_operation,
            id_worker: { in: workerIds },
          },
        });

        // Eliminar registros relacionados primero
        for (const opWorker of operationWorkersToDelete) {
          // Eliminar BillDetail
          await this.prisma.billDetail.deleteMany({
            where: { id_operation_worker: opWorker.id },
          });

          // Eliminar WorkerFeeding
          await this.prisma.workerFeeding.deleteMany({
            where: { 
              id_worker: opWorker.id_worker,
              id_operation: opWorker.id_operation 
            },
          });
        }

        // Ahora eliminar Operation_Worker
        await this.prisma.operation_Worker.deleteMany({
          where: {
            id_operation,
            id_worker: { in: workerIds },
          },
        });

        // Actualizar estado de los trabajadores eliminados
        await this.prisma.worker.updateMany({
          where: { id: { in: workerIds } },
          data: { status: 'AVALIABLE' },
        });

        return {
          message: `${workerIds.length} workers removed from operation ${id_operation}`,
          removedWorkers: workerIds,
        };
      }

      // CASO 2: Nuevo formato con id_group opcional
      if (workersToRemove && workersToRemove.length > 0) {
        const results: Array<{
          workerId: any;
          groupId?: any;
          action: string;
          success: boolean;
          workerReleased?: boolean;
          groupsRemoved?: number;
        }> = [];
        const allWorkerIds = workersToRemove.map((w) => w.id);

        // Validar que todos los trabajadores existen
        const workerValidation = await this.validationService.validateAllIds({
          workerIds: allWorkerIds,
        });

        if (
          workerValidation &&
          'status' in workerValidation &&
          workerValidation.status === 404
        ) {
          return workerValidation;
        }

       for (const workerToRemove of workersToRemove) {
          const { id: workerId, id_group } = workerToRemove;

          if (id_group) {
            // Eliminar solo del grupo específico
            // ✅ APLICAR ELIMINACIÓN EN CASCADA
            const operationWorkerToDelete = await this.prisma.operation_Worker.findFirst({
              where: {
                id_operation,
                id_worker: workerId,
                id_group: id_group,
              },
            });

            if (operationWorkerToDelete) {
              console.log(`[RemoveWorkerService] 🗑️ Eliminando worker ${workerId} del grupo ${id_group}`);
              
              // Eliminar BillDetail relacionados
              await this.prisma.billDetail.deleteMany({
                where: { id_operation_worker: operationWorkerToDelete.id },
              });

              // Eliminar WorkerFeeding relacionados
              await this.prisma.workerFeeding.deleteMany({
                where: { 
                  id_worker: operationWorkerToDelete.id_worker,
                  id_operation: operationWorkerToDelete.id_operation 
                },
              });

              // Eliminar Operation_Worker
              const deleteResult = await this.prisma.operation_Worker.delete({
                where: { id: operationWorkerToDelete.id },
              });
              
              console.log(`[RemoveWorkerService] ✅ Worker ${workerId} eliminado del grupo ${id_group}`);

              if (deleteResult) {
                results.push({
                  workerId,
                  groupId: id_group,
                  action: 'removed_from_group',
                  success: true,
                });

                // ✅ Verificar cuántos workers quedan en este grupo
                const remainingInGroup = await this.prisma.operation_Worker.count({
                  where: {
                    id_operation,
                    id_group: id_group,
                  },
                });
                
                console.log(`[RemoveWorkerService] 📊 Workers restantes en grupo ${id_group}: ${remainingInGroup}`);

                // Verificar si el trabajador aún está en otros grupos de esta operación
                const remainingInOperation =
                  await this.prisma.operation_Worker.findFirst({
                    where: {
                      id_operation,
                      id_worker: workerId,
                    },
                  });

                // Solo liberar si no está en otros grupos de esta operación
                if (!remainingInOperation) {
                  console.log(`[RemoveWorkerService] 🔄 Worker ${workerId} ya no está en operación ${id_operation}, verificando otras operaciones...`);
                  
                  // Verificar si está en otras operaciones activas
                  const inOtherActiveOps =
                    await this.prisma.operation_Worker.findFirst({
                      where: {
                        id_worker: workerId,
                        id_operation: { not: id_operation },
                        operation: {
                          status: { in: ['PENDING', 'INPROGRESS'] },
                        },
                      },
                    });

                  if (!inOtherActiveOps) {
                    await this.prisma.worker.update({
                      where: { id: workerId },
                      data: { status: 'AVALIABLE' },
                    });
                    console.log(`[RemoveWorkerService] ✅ Worker ${workerId} liberado (status: AVALIABLE)`);
                    results[results.length - 1].workerReleased = true;
                  }
                }
              }
            } else {
              // Worker no encontrado en el grupo específico
              // Esto puede ocurrir si Flutter tiene datos en caché
              console.log(`[RemoveWorkerService] ⚠️ Worker ${workerId} no encontrado en grupo ${id_group} (posible caché de Flutter)`);
              
              results.push({
                workerId,
                groupId: id_group,
                action: 'already_removed_from_group',
                success: true, // ✅ Marcar como exitoso porque el objetivo se cumplió (no está en el grupo)
              });
            }
          } else {
            // Eliminar de toda la operación
            // ✅ APLICAR ELIMINACIÓN EN CASCADA
            const operationWorkersToDelete = await this.prisma.operation_Worker.findMany({
              where: {
                id_operation,
                id_worker: workerId,
              },
            });

            if (operationWorkersToDelete.length > 0) {
              // Eliminar registros relacionados primero
              for (const opWorker of operationWorkersToDelete) {
                // Eliminar BillDetail
                await this.prisma.billDetail.deleteMany({
                  where: { id_operation_worker: opWorker.id },
                });

                // Eliminar WorkerFeeding
                await this.prisma.workerFeeding.deleteMany({
                  where: { 
                    id_worker: opWorker.id_worker,
                    id_operation: opWorker.id_operation 
                  },
                });
              }

              // Eliminar Operation_Worker
              const deleteResult = await this.prisma.operation_Worker.deleteMany({
                where: {
                  id_operation,
                  id_worker: workerId,
                },
              });

              if (deleteResult.count > 0) {
                results.push({
                  workerId,
                  action: 'removed_from_operation',
                  groupsRemoved: deleteResult.count,
                  success: true,
                });

                // Verificar si está en otras operaciones activas antes de liberar
                const inOtherActiveOps =
                  await this.prisma.operation_Worker.findFirst({
                    where: {
                      id_worker: workerId,
                      id_operation: { not: id_operation },
                      operation: {
                        status: { in: ['PENDING', 'INPROGRESS'] },
                      },
                    },
                  });

                if (!inOtherActiveOps) {
                  await this.prisma.worker.update({
                    where: { id: workerId },
                    data: { status: 'AVALIABLE' },
                  });
                  results[results.length - 1].workerReleased = true;
                }
              }
            } else {
              // Worker no encontrado en la operación
              // Esto puede ocurrir si Flutter tiene datos en caché
              console.log(`[RemoveWorkerService] ⚠️ Worker ${workerId} no encontrado en operación ${id_operation} (posible caché de Flutter)`);
              
              results.push({
                workerId,
                action: 'already_removed_from_operation',
                success: true, // ✅ Marcar como exitoso porque el objetivo se cumplió (no está en la operación)
              });
            }
          }
        }

        return {
          message: `Processed ${workersToRemove.length} worker removal requests`,
          results,
        };
      }

      return { message: 'No workers to remove', removedWorkers: [] };
    } catch (error) {
      console.error('Error removing workers from operation:', error);
      throw new Error(error.message);
    }
  }

  /**
   * Libera todos los trabajadores de una operación
   * @param id_operation
   * @returns Resultado de la liberación
   */
  async releaseAllWorkersFromOperation(id_operation: number) {
    try {
      // Obtener los trabajadores de esta operación
      const operationWorkers = await this.prisma.operation_Worker.findMany({
        where: { id_operation },
        select: { id_worker: true },
      });

      const workerIds = operationWorkers.map((ow) => ow.id_worker);

      if (workerIds.length === 0) {
        return {
          message: 'No workers assigned to this operation',
          releasedWorkers: [],
        };
      }

      // Verificar trabajadores en otras operaciones ACTIVAS (PENDING o INPROGRESS)
      const workersInActiveOperations =
        await this.prisma.operation_Worker.findMany({
          where: {
            id_worker: { in: workerIds },
            id_operation: { not: id_operation },
            operation: {
              status: { in: ['PENDING', 'INPROGRESS'] }, // Solo operaciones activas
            },
          },
          select: {
            id_worker: true,
            operation: {
              select: {
                id: true,
                status: true,
              },
            },
          },
        });

      const workerIdsInActiveOps = workersInActiveOperations.map(
        (w) => w.id_worker,
      );
      const workersToRelease = workerIds.filter(
        (id) => !workerIdsInActiveOps.includes(id),
      );

      // Liberar solo trabajadores que no están en operaciones activas
      if (workersToRelease.length > 0) {
        await this.prisma.worker.updateMany({
          where: {
            id: { in: workersToRelease },
            status: { not: 'AVALIABLE' },
          },
          data: { status: 'AVALIABLE' },
        });
      }

      // ✅ OBTENER FECHA/HORA DE LA OPERACIÓN COMPLETADA PARA RESPETAR LO QUE ELIGIÓ EL USUARIO
      const operation = await this.prisma.operation.findUnique({
        where: { id: id_operation },
        select: { dateEnd: true, timeEnd: true, status: true },
      });

      let finalDateEnd: Date;
      let finalTimeEnd: string;

      if (operation?.dateEnd && operation?.timeEnd) {
        // ✅ USAR FECHA/HORA QUE EL USUARIO ESPECIFICÓ AL COMPLETAR LA OPERACIÓN
        finalDateEnd = operation.dateEnd;
        finalTimeEnd = operation.timeEnd;
        console.log(`[RemoveWorkerService] Usando fecha/hora de la operación: ${finalDateEnd.toISOString()} ${finalTimeEnd}`);
      } else {
        // Solo como fallback usar hora actual
        finalDateEnd = getColombianDateTime();
        finalTimeEnd = getColombianTimeString();
        console.log(`[RemoveWorkerService] Usando fecha/hora actual como fallback: ${finalDateEnd.toISOString()} ${finalTimeEnd}`);
      }

      // Actualizar fecha de finalización en la tabla intermedia SOLO para trabajadores sin fecha de fin
      await this.prisma.operation_Worker.updateMany({
        where: { 
          id_operation, 
          dateEnd: null, 
          timeEnd: null,
          id_worker: { not: -1 } // ✅ EXCLUIR PLACEHOLDERS
        },
        data: {
          dateEnd: finalDateEnd,
          timeEnd: finalTimeEnd,
        },
      });

      return {
        message: `Operation ${id_operation} completed - ${workersToRelease.length} workers released`,
        releasedWorkers: workersToRelease,
      };
    } catch (error) {
      console.error('Error releasing workers from operation:', error);
      throw new Error(error.message);
    }
  }

  // Actualizar o agregar estos métodos:
  async removeWorkerFromGroup(
    operationId: number,
    workerId: number,
    groupId: string,
  ) {
    console.log('[RemoveWorkerService] removeWorkerFromGroup - Parámetros:', {
      operationId,
      workerId,
      groupId,
      workerIdType: typeof workerId
    });

    // Validar parámetros
    if (!operationId || !workerId || !groupId) {
      throw new BadRequestException('Parámetros inválidos: operationId, workerId y groupId son requeridos');
    }

    // ✅ VALIDAR QUE LA FACTURA DEL GRUPO NO ESTÉ COMPLETED
    const billInGroup = await this.prisma.bill.findFirst({
      where: {
        id_operation: operationId,
        id_group: groupId,
        status: 'COMPLETED',
      },
      select: {
        id: true,
        status: true,
      },
    });

    if (billInGroup) {
      console.log(`[RemoveWorkerService] ❌ Intento de eliminar trabajador de grupo con factura COMPLETED`);
      throw new BadRequestException(
        `No se puede eliminar el trabajador del grupo porque la factura asociada (ID: ${billInGroup.id}) tiene estado COMPLETED. Las facturas completadas no pueden ser modificadas.`
      );
    }

    // Validar que el trabajador existe - QUITAR operationIds
    console.log('[RemoveWorkerService] Validando trabajador:', workerId);
    await this.validationService.validateAllIds({
      workerIds: [workerId],  // Solo validar el trabajador
      // QUITAR: operationIds: [operationId],
    });

    // Validar que la operación existe por separado
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
    });

    if (!operation) {
      throw new NotFoundException(`Operación ${operationId} no encontrada`);
    }

    console.log('[RemoveWorkerService] Validación completada, eliminando del grupo');

    // ✅ PRIMERO: Buscar el operation_worker para obtener su ID
    const operationWorker = await this.prisma.operation_Worker.findFirst({
      where: {
        id_operation: operationId,
        id_worker: workerId,
        id_group: groupId,
      },
    });

    // console.log('[RemoveWorkerService] Resultado de eliminación:', operationWorker);

    if (!operationWorker) {
      throw new NotFoundException(
        `Trabajador ${workerId} no encontrado en el grupo ${groupId} de la operación ${operationId}`,
      );
    }
console.log(`[RemoveWorkerService] Operation_Worker encontrado con ID: ${operationWorker.id}`);

    // ✅ SEGUNDO: Eliminar BillDetail relacionados (si existen)
    const billDetailsToDelete = await this.prisma.billDetail.findMany({
      where: { id_operation_worker: operationWorker.id },
    });

    if (billDetailsToDelete.length > 0) {
      console.log(`[RemoveWorkerService] Eliminando ${billDetailsToDelete.length} BillDetail(s)...`);
      
      await this.prisma.billDetail.deleteMany({
        where: { id_operation_worker: operationWorker.id },
      });
      
      console.log('[RemoveWorkerService] ✅ BillDetails eliminados');
    }

    // ✅ TERCERO: Eliminar WorkerFeeding relacionados (si existen)
    const workerFeedingToDelete = await this.prisma.workerFeeding.findMany({
      where: { 
        id_worker: operationWorker.id_worker,
        id_operation: operationWorker.id_operation 
      },
    });

    if (workerFeedingToDelete.length > 0) {
      console.log(`[RemoveWorkerService] Eliminando ${workerFeedingToDelete.length} WorkerFeeding(s)...`);
      
      await this.prisma.workerFeeding.deleteMany({
        where: { 
          id_worker: operationWorker.id_worker,
          id_operation: operationWorker.id_operation 
        },
      });
      
      // console.log('[RemoveWorkerService] ✅ WorkerFeeding eliminados');
    }

    // ✅ CUARTO: Ahora sí eliminar el Operation_Worker
    const deleteResult = await this.prisma.operation_Worker.delete({
      where: { id: operationWorker.id },
    });

    console.log('[RemoveWorkerService] ✅ Operation_Worker eliminado:', deleteResult);
    // Verificar si el trabajador ya no tiene más asignaciones
    const remainingAssignments = await this.prisma.operation_Worker.count({
      where: { id_worker: workerId },
    });

    console.log('[RemoveWorkerService] Asignaciones restantes del trabajador:', remainingAssignments);

    if (remainingAssignments === 0) {
      await this.prisma.worker.update({
        where: { id: workerId },
        data: { status: 'AVALIABLE' },
      });
      console.log('[RemoveWorkerService] Trabajador marcado como AVAILABLE');
    }

    return {
      message: `Trabajador ${workerId} eliminado del grupo ${groupId}`,
      workersRemoved: 1,
    };
  }

  async removeWorkerFromOperation(operationId: number, workerId: number) {
    // console.log('[RemoveWorkerService] removeWorkerFromOperation - Parámetros:', {
    //   operationId,
    //   workerId,
    //   workerIdType: typeof workerId
    // });

    // Validar parámetros
    if (!operationId || !workerId) {
      throw new BadRequestException('Parámetros inválidos: operationId y workerId son requeridos');
    }

    // Validar que el trabajador existe - QUITAR operationIds
    // console.log('[RemoveWorkerService] Validando trabajador:', workerId);
    await this.validationService.validateAllIds({
      workerIds: [workerId],  // Solo validar el trabajador
      // QUITAR: operationIds: [operationId],
    });

    // Validar que la operación existe por separado
    const operation = await this.prisma.operation.findUnique({
      where: { id: operationId },
    });

    if (!operation) {
      throw new NotFoundException(`Operación ${operationId} no encontrada`);
    }

    // console.log('[RemoveWorkerService] Validación completada, eliminando de la operación');
    
   // ✅ PRIMERO: Buscar todos los operation_workers del trabajador en esta operación
    const operationWorkers = await this.prisma.operation_Worker.findMany({
      where: {
        id_operation: operationId,
        id_worker: workerId,
      },
    });

    if (operationWorkers.length === 0) {
      throw new NotFoundException(`Trabajador ${workerId} no encontrado en la operación ${operationId}`);
    }

    // console.log(`[RemoveWorkerService] Encontrados ${operationWorkers.length} registros Operation_Worker para eliminar`);

    // ✅ SEGUNDO: Eliminar BillDetail y WorkerFeeding para cada operation_worker
    for (const opWorker of operationWorkers) {
      // console.log(`[RemoveWorkerService] Procesando Operation_Worker ID: ${opWorker.id}`);
      // Eliminar BillDetail relacionados
      const billDetailsToDelete = await this.prisma.billDetail.findMany({
        where: { id_operation_worker: opWorker.id },
      });

      if (billDetailsToDelete.length > 0) {
        // console.log(`[RemoveWorkerService] Eliminando ${billDetailsToDelete.length} BillDetail(s) para Operation_Worker ${opWorker.id}...`);
        
        await this.prisma.billDetail.deleteMany({
          where: { id_operation_worker: opWorker.id },
        });
        
        console.log('[RemoveWorkerService] ✅ BillDetails eliminados');
      }

      // Eliminar WorkerFeeding relacionados
      const workerFeedingToDelete = await this.prisma.workerFeeding.findMany({
        where: { 
          id_worker: opWorker.id_worker,
          id_operation: opWorker.id_operation 
        },
      });

      if (workerFeedingToDelete.length > 0) {
        console.log(`[RemoveWorkerService] Eliminando ${workerFeedingToDelete.length} WorkerFeeding(s) para Operation_Worker ${opWorker.id}...`);
        
        await this.prisma.workerFeeding.deleteMany({
          where: { 
            id_worker: opWorker.id_worker,
            id_operation: opWorker.id_operation 
          },
        });
        
        // console.log('[RemoveWorkerService] ✅ WorkerFeeding eliminados');
      }
    }

    // ✅ TERCERO: Ahora sí eliminar todos los Operation_Worker
    const deleteResult = await this.prisma.operation_Worker.deleteMany({
      where: {
        id_operation: operationId,
        id_worker: workerId,
      },
    });

    console.log('[RemoveWorkerService] ✅ Operation_Workers eliminados:', deleteResult);

    // Verificar si el trabajador ya no tiene más asignaciones
    const remainingAssignments = await this.prisma.operation_Worker.count({
      where: { id_worker: workerId },
    });

    console.log('[RemoveWorkerService] Asignaciones restantes del trabajador:', remainingAssignments);

    if (remainingAssignments === 0) {
      await this.prisma.worker.update({
        where: { id: workerId },
        data: { status: 'AVALIABLE' },
      });
      console.log('[RemoveWorkerService] Trabajador marcado como AVAILABLE');
    }

    return {
      message: `Trabajador ${workerId} eliminado de la operación ${operationId}`,
      workersRemoved: deleteResult.count,
    };
  }
}
