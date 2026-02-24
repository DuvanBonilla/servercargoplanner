import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UpdateOperationService } from './services/update-operation.service';
import { UpdateWorkerService } from './services/update-worker.service';
import { UpdateOperationWorkerService } from './services/update-operation-worker.service';
import { UpdatePermissionService } from 'src/permission/services/update-permission.service';
import { UpdateInabilityService } from 'src/inability/service/update-inability.service';

/**
 * Servicio para gestionar Cron Jobs
 * 
 * OPTIMIZACIONES IMPLEMENTADAS:
 * - ⏱️ Intervalo aumentado a 5 minutos para reducir carga del servidor
 * - 🚀 Early exit cuando no hay operaciones pendientes
 * - 📊 Límite de 50 operaciones por ejecución
 * - 🔄 Transacciones atómicas para consistencia
 * - 🗂️ Sistema de caché para evitar consultas innecesarias
 * - 📈 Métricas de rendimiento y monitoreo
 * 
 * @class OperationsCronService
 */
@Injectable()
export class OperationsCronService {
  private readonly logger = new Logger(OperationsCronService.name);
  private isEnabled: boolean = true; // 🎛️ Control de activación del cron job

  constructor(
    private updateOperation: UpdateOperationService,
    private updateWorker: UpdateWorkerService,
    private updateOperationWorker: UpdateOperationWorkerService,
    private updatePermission: UpdatePermissionService,
    private updateInability:UpdateInabilityService, 
  ) {}

  /**
   * Habilita o deshabilita el cron job de operaciones
   * @param enabled - true para habilitar, false para deshabilitar
   */
  setOperationsCronEnabled(enabled: boolean) {
    this.isEnabled = enabled;
    this.logger.log(`🎛️ Cron job de operaciones ${enabled ? 'HABILITADO' : 'DESHABILITADO'}`);
  }
  /**
   * Actualiza las operaciones en progreso
   * Inicializa operaciones PENDING a INPROGRESS cuando llega su fecha y hora programada
   * Se ejecuta cada 5 minutos, con optimizaciones inteligentes para reducir carga
   */
  @Cron('*/5 * * * *') // Cada 5 minutos (optimizado para reducir carga)
  async handleUpdateInProgressOperations() {
    // 🎛️ Verificar si el cron job está habilitado
    if (!this.isEnabled) {
      return; // Salir silenciosamente si está deshabilitado
    }

    try {
      const result = await this.updateOperation.updateInProgressOperations();
      
      if (result.updatedCount > 0) {
        this.logger.log(`✅ ${result.updatedCount} operaciones iniciadas automáticamente`);
      }
      
      // 📊 Log informativo sobre optimizaciones
      if (result.skipped && result.reason === 'Deep sleep mode') {
        this.logger.debug(`😴 Modo sueño profundo activo (próxima verificación en ${result.nextCheck} minutos)`);
      } else if (result.consecutiveEmptyRuns && result.consecutiveEmptyRuns >= 3) {
        this.logger.debug(`📈 ${result.consecutiveEmptyRuns} ejecuciones consecutivas sin operaciones${result.willEnterDeepSleep ? ' - entrando en modo sueño profundo' : ''}`);
      }
    } catch (error) {
      this.logger.error('Error in cron job updateInProgressOperations:', error);
    }
  }

  /**
   * Actualiza los trabajadores con permisos que inician hoy
   */
  @Cron(CronExpression.EVERY_10_MINUTES)
  async handleUpdateWorkersWithStartingPermissions() {
    try {
      await this.updatePermission.updateWorkersWithStartingPermissions();
    } catch (error) {
      this.logger.error('Error updating workers with starting permissions:', error);
    }
  }

  /**
   * 🔄 HÍBRIDO: Verificación reactiva + CronJob de respaldo cada hora
   * 
   * Los permisos expirados se verifican automáticamente cuando:
   * - Se lista trabajadores (GET /workers)
   * - Se asigna un trabajador a una operación
   * 
   * Este CronJob actúa como red de seguridad cada hora para casos donde:
   * - Nadie consulta trabajadores por períodos largos
   * - Permisos expiran sin que se dispare verificación reactiva
   */
  @Cron(CronExpression.EVERY_HOUR)
  async handleUpdateWorkersWithExpiredPermissions() {
    try {
      await this.updatePermission.updateWorkersWithExpiredPermissions();
    } catch (error) {
      this.logger.error('Error updating workers with expired permissions:', error);
    }
  }

/**
   * Actualiza los trabajadores con incapacidades expiradas
   */

@Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
async handleUpdateWorkersWithExpiredInabilities() {
  try {
    await this.updateInability.updateWorkersWithExpiredInabilities();
  } catch (error) {
    this.logger.error('Error updating workers with expired inabilities:', error);
  }
}


  /**
   * Actualiza los trabajadores deshabilitados
   */
  // @Cron(CronExpression.EVERY_DAY_AT_MIDNIGHT)
  // async handleUpdateDisabledWorkers() {
  //   try {
  //     await this.updateWorker.updateDisabledWorkers();
  //   } catch (error) {
  //     this.logger.error('Error in cron job:', error);
  //   }
  // }
  /**
   * Actualiza las operaciones completadas
   */
  // @Cron(CronExpression.EVERY_5_MINUTES)
  // async handleUpdateCompletedOperations() {
  //   try {
  //     await this.updateOperation.updateCompletedOperations();
  //   } catch (error) {
  //     this.logger.error('Error in cron job:', error);
  //   }
  // }

  /**
   * Actulizar trabajadores con fallas
   */
  @Cron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  async handleUpdateWorkersWithFailures() {
    try {
      await this.updateWorker.updateWorkerFailures();
    } catch (error) {
      this.logger.error('Error in cron job:', error);
    }
  }

  /**
   * Actualizar trabajadores según su programación
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async handleUpdateWorkersScheduleState() {
    try {
      await this.updateOperationWorker.updateWorkersScheduleState();
    } catch (error) {
      this.logger.error('Error in cron job:', error);
    }
  }

//  @Cron(CronExpression.EVERY_MINUTE) 
// async handleCleanupOldOperations() {
//   try {
//     this.logger.log('Starting cleanup of old operations...');
//     const result = await this.updateWorker.cleanupOldOperations(2); // 2 días en lugar de 30
//     this.logger.log(`Cleanup completed: ${result.deletedCount} operations deleted`);
//   } catch (error) {
//     this.logger.error('Error in cleanup old operations cron job:', error);
//   }
// }

}
