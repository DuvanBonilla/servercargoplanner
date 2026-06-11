import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from 'src/prisma/prisma.service';
import { StatusOperation } from '@prisma/client';

@Injectable()
export class CancelledOperationsCleanupService {
  private readonly logger = new Logger(CancelledOperationsCleanupService.name);

  constructor(private prisma: PrismaService) {}
 /**
   * Cron job que se ejecuta el primer día de cada mes a las 00:01
   * Reinicia el contador de horas trabajadas para todos los workers
   */
  @Cron('1 0 1 * *', {
    name: 'monthly-hours-reset',
    timeZone: 'America/Bogota',
  })

  /**
   * Ejecuta cada día a las 00:00 para limpiar operaciones canceladas y desactivadas
   */
  @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  async cleanupCancelledOperations() {
    // this.logger.log('Iniciando limpieza de operaciones canceladas y desactivadas...');
    
    try {
      // this.logger.log(' Buscando TODAS las operaciones canceladas y desactivadas (sin límite de fecha)');

      // Buscar TODAS las operaciones canceladas Y desactivadas (sin filtro de fecha)
      const operationsToDelete = await this.prisma.operation.findMany({
        where: {
          status: {
            in: [StatusOperation.CANCELED, StatusOperation.DEACTIVATED]
          }
          // Removido el filtro de updateAt
        },
        select: {
          id: true,
          status: true,
          updateAt: true // Para debugging
        }
      });

      if (operationsToDelete.length === 0) {
        // this.logger.log(' No hay operaciones canceladas o desactivadas para eliminar');
        return;
      }

      // Contar por estado para mejor logging
      const cancelledCount = operationsToDelete.filter(op => op.status === StatusOperation.CANCELED).length;
      const deactivatedCount = operationsToDelete.filter(op => op.status === StatusOperation.DEACTIVATED).length;

      // this.logger.log(` Encontradas ${operationsToDelete.length} operaciones para eliminar:`);
      // this.logger.log(` ${cancelledCount} CANCELED`);
      // this.logger.log(` ${deactivatedCount} DEACTIVATED`);

      // Log de algunas operaciones para debugging
      // operationsToDelete.slice(0, 3).forEach(op => {
      //   this.logger.log(` ID: ${op.id}, Estado: ${op.status}, Última actualización: ${op.updateAt}`);
      // });

      // Eliminar cada operación con sus dependencias
      let deletedCount = 0;
      let skippedCount = 0;
      let errorCount = 0;

      for (const operation of operationsToDelete) {
        try {
          await this.deleteOperationWithDependencies(operation.id);
          deletedCount++;
          // this.logger.log(` Operación eliminada: ID ${operation.id} (Estado: ${operation.status})`);
        } catch (error) {
          if (String(error).includes('no se puede eliminar porque tiene')) {
            skippedCount++;
            this.logger.warn(`Operación omitida: ID ${operation.id} - ${(error as Error).message}`);
          } else {
            errorCount++;
            this.logger.error(` Error eliminando operación ID ${operation.id} (Estado: ${operation.status}):`, String(error));
          }
        }
      }

      // this.logger.log(` Limpieza completada:`);
      // this.logger.log(`    ${deletedCount} eliminadas`);
      // this.logger.log(`    ${skippedCount} omitidas (tienen datos críticos)`);
      // this.logger.log(`    ${errorCount} errores`);
      // this.logger.log(`    ${operationsToDelete.length} total procesadas`);

    } catch (error) {
      this.logger.error(' Error durante la limpieza de operaciones:', String(error));
      this.logger.error('Stack trace:', String(error));
    }
  }

  /**
   * Elimina una operación y todas sus dependencias en el orden correcto
   * Solo si la operación no tiene registros críticos como facturas o alimentación
   */
  private async deleteOperationWithDependencies(operationId: number) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Obtener la operación para verificar relaciones
      const operation = await tx.operation.findUnique({
        where: { id: operationId },
        select: { 
          id_clientProgramming: true,
          id: true
        }
      });

      if (!operation) {
        throw new Error(`Operación ${operationId} no encontrada`);
      }

      // 2. VALIDACIÓN CRÍTICA: Verificar si tiene facturas
      const existingBills = await tx.bill.count({
        where: { id_operation: operationId }
      });

      if (existingBills > 0) {
        throw new Error(`Operación ${operationId} no se puede eliminar porque tiene ${existingBills} factura(s) asociada(s)`);
      }

      // 3. VALIDACIÓN CRÍTICA: Verificar si tiene registros de alimentación
      const existingFeedings = await tx.workerFeeding.count({
        where: { id_operation: operationId }
      });

      if (existingFeedings > 0) {
        throw new Error(`Operación ${operationId} no se puede eliminar porque tiene ${existingFeedings} registro(s) de alimentación`);
      }

      // 4. VALIDACIÓN ADICIONAL: Verificar si tiene BillDetail
      const operationWorkers = await tx.operation_Worker.findMany({
        where: { id_operation: operationId },
        select: { id: true }
      });

      let totalBillDetails = 0;
      for (const opWorker of operationWorkers) {
        const billDetailCount = await tx.billDetail.count({
          where: { id_operation_worker: opWorker.id }
        });
        totalBillDetails += billDetailCount;
      }

      if (totalBillDetails > 0) {
        throw new Error(`Operación ${operationId} no se puede eliminar porque tiene ${totalBillDetails} detalle(s) de factura`);
      }

      // 5. Eliminar Operation_Worker
      await tx.operation_Worker.deleteMany({
        where: { id_operation: operationId }
      });

      // 6. Eliminar InChargeOperation
      await tx.inChargeOperation.deleteMany({
        where: { id_operation: operationId }
      });

      // 7. Eliminar ClientProgramming si existe relación
      if (operation.id_clientProgramming) {
        try {
          await tx.clientProgramming.delete({
            where: { id: operation.id_clientProgramming }
          });
        } catch (error) {
          // No es crítico si falla
        }
      }

      // 8. Finalmente eliminar la operación
      await tx.operation.delete({
        where: { id: operationId }
      });
      
    }, {
      timeout: 60000,
    });
  }

  /**
   * Método manual para limpiar operaciones canceladas y desactivadas
   */
  async manualCleanup(includeDeactivated: boolean = true, useDateFilter: boolean = false, daysOld: number = 30) {
    const statusesToClean = includeDeactivated 
      ? [StatusOperation.CANCELED, StatusOperation.DEACTIVATED]
      : [StatusOperation.CANCELED];

    const dateFilterText = useDateFilter ? `con filtro de ${daysOld} días` : 'sin filtro de fecha';
    // this.logger.log(`🔧 Ejecutando limpieza manual ${dateFilterText} - Estados: ${statusesToClean.join(', ')}`);
    
    const whereCondition: any = {
      status: {
        in: statusesToClean
      }
    };

    // Solo agregar filtro de fecha si se especifica
    if (useDateFilter) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      whereCondition.updateAt = {
        lt: cutoffDate
      };
    }

    const operationsToDelete = await this.prisma.operation.findMany({
      where: whereCondition,
      select: {
        id: true,
        status: true
      }
    });

    let deletedCount = 0;
    let skippedCount = 0;
    let errorCount = 0;

    for (const operation of operationsToDelete) {
      try {
        await this.deleteOperationWithDependencies(operation.id);
        deletedCount++;
      } catch (error) {
        if (String(error).includes('no se puede eliminar porque tiene')) {
          skippedCount++;
        } else {
          errorCount++;
          this.logger.error(`Error eliminando operación ID ${operation.id}:`, String(error));
        }
      }
    }

    return {
      message: `${deletedCount} operaciones eliminadas, ${skippedCount} omitidas, ${errorCount} errores`,
      deletedCount,
      skippedCount,
      errorCount,
      totalFound: operationsToDelete.length,
      statusesCleaned: statusesToClean,
      usedDateFilter: useDateFilter
    };
  }

  /**
   * Método para verificar qué operaciones pueden eliminarse
   */
  async getCleanupPreview(useDateFilter: boolean = false, daysOld: number = 30) {
    const whereCondition: any = {
      status: {
        in: [StatusOperation.CANCELED, StatusOperation.DEACTIVATED]
      }
    };

    // Solo agregar filtro de fecha si se especifica
    if (useDateFilter) {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - daysOld);
      whereCondition.updateAt = {
        lt: cutoffDate
      };
    }

    const operations = await this.prisma.operation.findMany({
      where: whereCondition,
      select: {
        id: true,
        status: true,
        updateAt: true,
        Bill: { select: { id: true } },
        feeding: { select: { id: true } },
        workers: {
          select: {
            id: true,
            billDetail: { select: { id: true } }
          }
        }
      }
    });

    const canDelete: { id: number; status: StatusOperation; updateAt: Date }[] = [];
    const cannotDelete: { id: number; status: StatusOperation; updateAt: Date; reason: string }[] = [];

    for (const op of operations) {
      const hasBills = op.Bill.length > 0;
      const hasFeeding = op.feeding.length > 0;
      const hasBillDetails = op.workers.some(w => w.billDetail.length > 0);

      if (hasBills || hasFeeding || hasBillDetails) {
        cannotDelete.push({
          id: op.id,
          status: op.status,
          updateAt: op.updateAt,
          reason: hasBills ? 'Tiene facturas' : hasFeeding ? 'Tiene alimentación' : 'Tiene detalles de factura'
        });
      } else {
        canDelete.push({
          id: op.id,
          status: op.status,
          updateAt: op.updateAt
        });
      }
    }

    return {
      dateFilter: useDateFilter ? `${daysOld} días` : 'Sin filtro de fecha',
      total: operations.length,
      canDelete: canDelete.length,
      cannotDelete: cannotDelete.length,
      details: {
        canDelete,
        cannotDelete
      }
    };
  }
async resetMonthlyWorkedHours() {
    // this.logger.log('🔄 Iniciando reinicio mensual de horas trabajadas...');
    
    try {
      const currentDate = new Date();
      const currentMonth = currentDate.getMonth() + 1;
      const currentYear = currentDate.getFullYear();
      
      // this.logger.log(`📅 Reiniciando horas para ${currentMonth}/${currentYear}`);

      // Obtener todos los workers con horas trabajadas > 0
      const workersWithHours = await this.prisma.worker.findMany({
        where: {
          hoursWorked: {
            gt: 0
          }
        },
        select: {
          id: true,
          name: true,
          hoursWorked: true,
          updateAt: true
        }
      });

      // this.logger.log(`👥 Encontrados ${workersWithHours.length} workers con horas registradas`);

      if (workersWithHours.length === 0) {
        // this.logger.log('ℹ️ No hay workers con horas para reiniciar');
        return {
          success: true,
          workersReset: 0,
          message: 'No hay workers con horas para reiniciar'
        };
      }

      // Crear registro histórico antes de reiniciar
      await this.createMonthlyReport(workersWithHours, currentDate);

      // Reiniciar horas trabajadas para todos los workers
      const updateResult = await this.prisma.worker.updateMany({
        where: {
          hoursWorked: {
            gt: 0
          }
        },
        data: {
          hoursWorked: 0,
          updateAt: currentDate
        }
      });

      // this.logger.log(`✅ Reinicio completado: ${updateResult.count} workers actualizados`);
      
      return {
        success: true,
        workersReset: updateResult.count,
        month: currentMonth,
        year: currentYear,
        reportCreated: true
      };

    } catch (error) {
      this.logger.error('❌ Error durante el reinicio mensual de horas:', error);
      throw error;
    }
  }

  /**
   * Crear reporte histórico mensual de horas trabajadas
   */
  private async createMonthlyReport(workers: any[], resetDate: Date) {
    try {
      const previousMonth = new Date(resetDate);
      previousMonth.setMonth(previousMonth.getMonth() - 1);
      
      // Crear tabla de reporte si no existe
      await this.prisma.$executeRaw`
        CREATE TABLE IF NOT EXISTS monthly_hours_report (
          id SERIAL PRIMARY KEY,
          id_worker INTEGER NOT NULL,
          worker_name VARCHAR(255) NOT NULL,
          total_hours DECIMAL(8,2) NOT NULL DEFAULT 0,
          month INTEGER NOT NULL,
          year INTEGER NOT NULL,
          created_at TIMESTAMP NOT NULL,
          last_update TIMESTAMP,
          UNIQUE(id_worker, month, year)
        );
      `;

      // Insertar reportes
      for (const worker of workers) {
        await this.prisma.$executeRaw`
          INSERT INTO monthly_hours_report 
          (id_worker, worker_name, total_hours, month, year, created_at, last_update)
          VALUES (${worker.id}, ${worker.name}, ${worker.hoursWorked}, 
                  ${previousMonth.getMonth() + 1}, ${previousMonth.getFullYear()}, 
                  ${resetDate}, ${worker.updateAt})
          ON CONFLICT (id_worker, month, year) 
          DO UPDATE SET 
            total_hours = EXCLUDED.total_hours,
            created_at = EXCLUDED.created_at,
            last_update = EXCLUDED.last_update;
        `;
      }

      // this.logger.log(`📋 Reporte histórico guardado para ${workers.length} workers`);

    } catch (error) {
      this.logger.error('❌ Error creando reporte mensual:', error);
    }
  }

  /**
   * Ejecutar reinicio manual de horas trabajadas
   */
  async manualReset(dryRun: boolean = false) {
    // this.logger.log(`🔧 Reinicio manual iniciado ${dryRun ? '(SIMULACIÓN)' : '(REAL)'}`);
    
    try {
      const workersWithHours = await this.prisma.worker.findMany({
        where: {
          hoursWorked: {
            gt: 0
          }
        },
        select: {
          id: true,
          name: true,
          hoursWorked: true,
          updateAt: true
        }
      });

      

      // this.logger.log(`📊 Workers encontrados con horas: ${workersWithHours.length}`);
      
      const summary = workersWithHours.map(worker => ({
        id: worker.id,
        name: worker.name,
        hoursWorked: worker.hoursWorked,
        lastUpdate: worker.updateAt
      }));

      if (!dryRun && workersWithHours.length > 0) {
        // Crear reporte histórico
        await this.createMonthlyReport(workersWithHours, new Date());
        
        // Reiniciar horas
        const result = await this.prisma.worker.updateMany({
          where: {
            hoursWorked: {
              gt: 0
            }
          },
          data: {
            hoursWorked: 0,
            updateAt: new Date()
          }
        });

        // this.logger.log(`✅ Reinicio manual completado: ${result.count} workers actualizados`);
        
        return {
          success: true,
          dryRun: false,
          workersReset: result.count,
          workersDetails: summary,
          message: `Se reiniciaron las horas de ${result.count} trabajadores`
        };
      }

      return {
        success: true,
        dryRun: true,
        workersFound: workersWithHours.length,
        workersDetails: summary,
        message: `Simulación: Se reiniciarían las horas de ${workersWithHours.length} trabajadores`
      };

    } catch (error) {
      this.logger.error('❌ Error en reinicio manual:', error);
      throw error;
    }
  }

  /**
   * Obtener estadísticas actuales de horas trabajadas
   */
  async getCurrentMonthStats() {
    try {
      const stats = await this.prisma.worker.aggregate({
        _count: {
          id: true
        },
        _sum: {
          hoursWorked: true
        },
        _avg: {
          hoursWorked: true
        },
        _max: {
          hoursWorked: true
        },
        where: {
          hoursWorked: {
            gt: 0
          }
        }
      });

      const topWorkers = await this.prisma.worker.findMany({
        where: {
          hoursWorked: {
            gt: 0
          }
        },
        select: {
          id: true,
          name: true,
          hoursWorked: true,
          updateAt: true
        },
        orderBy: {
          hoursWorked: 'desc'
        },
        take: 10
      });

      return {
        summary: {
          totalWorkersWithHours: stats._count.id || 0,
          totalHours: Number(stats._sum.hoursWorked) || 0,
          averageHours: Number(stats._avg.hoursWorked) || 0,
          maxHours: Number(stats._max.hoursWorked) || 0
        },
        topWorkers,
        generatedAt: new Date(),
        currentMonth: new Date().getMonth() + 1,
        currentYear: new Date().getFullYear()
      };

    } catch (error) {
      this.logger.error('❌ Error obteniendo estadísticas:', error);
      throw error;
    }
  }

}