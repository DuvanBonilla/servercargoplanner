import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { UpdateOperationService } from './services/update-operation.service';
import { UpdateWorkerService } from './services/update-worker.service';
import { UpdateOperationWorkerService } from './services/update-operation-worker.service';
import { UpdatePermissionService } from 'src/permission/services/update-permission.service';
import { UpdateInabilityService } from 'src/inability/service/update-inability.service';

/**
 * Servicio para gestionar Cron Jobs
 * @class OperationsCronService
 */
@Injectable()
export class OperationsCronService {
  private readonly logger = new Logger(OperationsCronService.name);

  constructor(
    private updateOperation: UpdateOperationService,
    private updateWorker: UpdateWorkerService,
    private updateOperationWorker: UpdateOperationWorkerService,
    private updatePermission: UpdatePermissionService,
    private updateInability:UpdateInabilityService, 
  ) {}
  /**
   * Actualiza las operaciones en progreso
   * Cambiado de EVERY_MINUTE a cada 2 minutos para reducir carga del servidor
   */
  // @Cron('*/2 * * * *') // Cada 2 minutos
  // async handleUpdateInProgressOperations() {
  //   try {
  //     await this.updateOperation.updateInProgressOperations();
  //   } catch (error) {
  //     this.logger.error('Error in cron job:', error);
  //   }
  // }

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
