import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { differenceInMinutes } from 'date-fns';
import {
  getColombianDateTime,
  getColombianTimeString,
  getColombianStartOfDay,
  getColombianEndOfDay,
} from 'src/common/utils/dateColombia';
import { BillService } from 'src/bill/bill.service';
import { Decimal } from '@prisma/client/runtime/library';

@Injectable()
export class UpdateOperationService {
  private readonly logger = new Logger(UpdateOperationService.name);
  private lastProcessedTime: Date | null = null; // 🗂️ CACHÉ: Última vez que se procesaron operaciones
  private lastPendingCount: number = 0; // 📊 CACHÉ: Último conteo de operaciones pendientes
  private consecutiveEmptyRuns: number = 0; // 📈 CONTADOR: Ejecuciones consecutivas sin operaciones
  private isInDeepSleep: boolean = false; // 😴 ESTADO: Modo de sueño profundo

  constructor(
    private prisma: PrismaService,
    private billService: BillService,
  ) {}

  /**
   * 🔔 Despierta el sistema del modo sueño profundo
   * Se llama cuando se crea una nueva operación
   */
  wakeUpFromDeepSleep(reason: string = 'Nueva operación creada') {
    if (this.isInDeepSleep) {
      this.logger.log(`🔔 DESPERTANDO del sueño profundo: ${reason}`);
      this.isInDeepSleep = false;
      this.consecutiveEmptyRuns = 0;
      this.lastPendingCount = 1; // Indicar que hay operaciones pendientes
    }
  }

  /**
   * 📊 Obtiene el estado actual del sistema de optimización
   */
  getSystemStatus() {
    return {
      isInDeepSleep: this.isInDeepSleep,
      consecutiveEmptyRuns: this.consecutiveEmptyRuns,
      lastProcessedTime: this.lastProcessedTime,
      lastPendingCount: this.lastPendingCount
    };
  }

  // /**
  //  * 🚨 Fuerza la activación de operaciones atascadas (ignora período de gracia)
  //  * Útil para operaciones que quedaron atoradas en PENDING por bugs de tiempo
  //  */
  // async forceActivateStuckOperations() {
  //   const now = getColombianDateTime();
  //   this.logger.log(`🚨 FORZANDO activación de operaciones atascadas...`);
    
  //   // Buscar operaciones PENDING que deberían estar activas
  //   const stuckOperations = await this.prisma.operation.findMany({
  //     where: {
  //       status: 'PENDING',
  //       dateStart: {
  //         lte: now, // Operaciones de hoy o anteriores
  //       },
  //     },
  //     select: {
  //       id: true,
  //       dateStart: true,
  //       timeStrat: true,
  //       createAt: true,
  //     },
  //   });

  //   let forceUpdatedCount = 0;
    
  //   for (const operation of stuckOperations) {
  //     const [hours, minutes] = operation.timeStrat.split(':').map(Number);
  //     const startDateTime = new Date(operation.dateStart);
  //     startDateTime.setHours(hours, minutes, 0, 0);

  //     const minutesDiff = differenceInMinutes(now, startDateTime);
  //     const minutesSinceCreation = differenceInMinutes(now, operation.createAt);
      
  //     // Solo activar si la hora programada ya pasó
  //     if (minutesDiff >= 0) {
  //       this.logger.log(`🚨 FORZANDO operación ${operation.id} - creada hace ${minutesSinceCreation} minutos, debería haber iniciado hace ${minutesDiff} minutos`);
        
  //       await this.prisma.$transaction(async (tx) => {
  //         await tx.operation.update({
  //           where: { id: operation.id },
  //           data: { status: 'INPROGRESS' },
  //         });

  //         await tx.operation_Worker.updateMany({
  //           where: {
  //             id_operation: operation.id,
  //             dateEnd: null,
  //             timeEnd: null,
  //           },
  //           data: {
  //             dateStart: operation.dateStart,
  //             timeStart: operation.timeStrat,
  //           },
  //         });
  //       });
        
  //       forceUpdatedCount++;
  //     }
  //   }

  //   this.logger.log(`🚨 FORZADO completado: ${forceUpdatedCount} operaciones activadas`);
  //   return { forceUpdatedCount };
  // }

  /**
   * Actualiza las operaciones de estado PENDING a INPROGRESS cuando hayan pasado las condiciones necesarias.
   * 
   * LÓGICA IMPLEMENTADA:
   * - 🛡️ PERÍODO DE GRACIA: Operaciones creadas hace menos de 3 minutos no se procesan automáticamente
   * - ⏰ OPERACIONES PASADAS: Se activan inmediatamente (respetando período de gracia)
   * - 📅 OPERACIONES DE HOY: Se activan 1 minuto después de la hora programada
   * - 🔮 OPERACIONES FUTURAS: Se mantienen en PENDING
   * 
   * El período de gracia es especialmente útil para:
   * - Operaciones duplicadas que necesitan edición de fechas/horas
   * - Operaciones creadas manualmente que requieren ajustes
   * - Evitar activación prematura durante el proceso de edición
   */
  async updateInProgressOperations() {
    try {
      const now = getColombianDateTime();

      // 😴 OPTIMIZACIÓN AVANZADA: Sueño profundo después de 6 ejecuciones sin operaciones
      if (this.consecutiveEmptyRuns >= 6) {
        if (!this.isInDeepSleep) {
          this.logger.log('😴 Activando modo sueño profundo - sin operaciones en los últimos 30 minutos');
          this.isInDeepSleep = true;
        }
        
        // En sueño profundo, solo verificar cada 30 minutos (6 ejecuciones * 5 min = 30 min)
        const timeSinceLastCheck = this.lastProcessedTime 
          ? differenceInMinutes(now, this.lastProcessedTime) 
          : 999;
          
        if (timeSinceLastCheck < 30) {
          this.logger.debug('😴 En modo sueño profundo, saltando verificación (próxima en ' + (30 - timeSinceLastCheck) + ' minutos)');
          return { 
            updatedCount: 0, 
            skipped: true, 
            reason: 'Deep sleep mode', 
            nextCheck: 30 - timeSinceLastCheck,
            consecutiveEmptyRuns: this.consecutiveEmptyRuns,
            willEnterDeepSleep: false
          };
        }
      }

      this.logger.debug('🔍 Verificando operaciones para actualizar a INPROGRESS...');

      // 📊 OPTIMIZACIÓN: Verificar si es necesario procesar basado en tiempo
      const timeSinceLastProcess = this.lastProcessedTime 
        ? differenceInMinutes(now, this.lastProcessedTime) 
        : 999;

      if (timeSinceLastProcess < 3 && this.lastPendingCount === 0 && !this.isInDeepSleep) {
        this.logger.debug('⏭️ Saltando procesamiento: no hay operaciones pendientes recientes');
        return { 
          updatedCount: 0, 
          skipped: true, 
          reason: 'No pending operations recently',
          consecutiveEmptyRuns: this.consecutiveEmptyRuns,
          willEnterDeepSleep: false
        };
      }

      // Crear fecha de inicio (hoy a medianoche hora colombiana)
      const startOfDay = getColombianStartOfDay(now);

      // Crear fecha de fin (mañana a medianoche hora colombiana)
      const endOfDay = getColombianEndOfDay(now);

      this.logger.debug(`⏰ Hora colombiana actual: ${now.toISOString()}`);
      this.logger.debug(`📅 Buscando operaciones para fecha: ${startOfDay.toISOString()}`);

      // 🚀 OPTIMIZACIÓN: Verificar si hay operaciones pendientes antes de procesarlas
      const pendingCount = await this.prisma.operation.count({
        where: {
          dateStart: {
            lt: endOfDay, // Menor que mañana a medianoche (hora colombiana)
          },
          status: 'PENDING',
        },
      });

      // ⚡ EARLY EXIT: Si no hay operaciones pendientes, salir inmediatamente
      if (pendingCount === 0) {
        this.consecutiveEmptyRuns++; // 📈 Incrementar contador de ejecuciones vacías
        this.lastProcessedTime = now; // 🗂️ Actualizar caché
        this.lastPendingCount = 0;
        
        this.logger.debug(`🆕 No hay operaciones PENDING (${this.consecutiveEmptyRuns} ejecuciones consecutivas sin operaciones)`);
        
        return { 
          updatedCount: 0, 
          consecutiveEmptyRuns: this.consecutiveEmptyRuns,
          willEnterDeepSleep: this.consecutiveEmptyRuns >= 5
        };
      }

      // 🔄 RESETEAR contadores cuando encontramos operaciones
      if (this.consecutiveEmptyRuns > 0) {
        this.logger.log(`🔄 Encontradas operaciones PENDING, saliendo del modo optimizado (${this.consecutiveEmptyRuns} ejecuciones previas sin operaciones)`);
        this.consecutiveEmptyRuns = 0;
        this.isInDeepSleep = false;
      }

      this.logger.debug(`📋 Encontradas ${pendingCount} operaciones PENDING, procesando...`);

      // Buscar operaciones pendientes con límite para evitar sobrecarga
      const pendingOperations = await this.prisma.operation.findMany({
        where: {
          dateStart: {
            lt: endOfDay, // Menor que mañana a medianoche (hora colombiana)
          },
          status: 'PENDING',
        },
        take: 50, // 🛡️ LÍMITE: Procesar máximo 50 operaciones por ejecución
        orderBy: {
          dateStart: 'asc', // Priorizar operaciones más antiguas
        },
        select: {
          id: true,
          dateStart: true,
          timeStrat: true,
          createAt: true, // 🕐 IMPORTANTE: Necesario para verificar período de gracia
        },
      });

      let updatedCount = 0;
      let gracePeriodCount = 0; // 📊 Contador de operaciones en período de gracia

//       for (const operation of pendingOperations) {
//         // Crear la fecha de inicio completa combinando dateStart y timeStrat
//         // const dateStartStr = operation.dateStart.toISOString().split('T')[0];
//         // const startDateTime = new Date(`${dateStartStr}T${operation.timeStrat}`,);
//         const [hours, minutes] = operation.timeStrat.split(':').map(Number);
// const startDateTime = new Date(operation.dateStart);
// startDateTime.setHours(hours, minutes, 0, 0);

//         // Verificar si han pasado 5 minutos desde la hora de inicio (usando hora colombiana)
//         const minutesDiff = differenceInMinutes(now, startDateTime);
//         this.logger.debug(
//           `Operation ${operation.id}: ${minutesDiff} minutes since start time (Colombian time)`,
//         );

//         if (minutesDiff >= 1) {
//           // Actualizar el estado a INPROGRESS
//           await this.prisma.operation.update({
//             where: { id: operation.id },
//             data: { status: 'INPROGRESS' },
//           });

//           // Actualizar la fecha y hora de inicio en la tabla intermedia (con hora colombiana)
//           await this.prisma.operation_Worker.updateMany({
//             where: {
//               id_operation: operation.id,
//               dateEnd: null,
//               timeEnd: null,
//             },
//             data: {
//               dateStart: operation.dateStart,
//               timeStart: operation.timeStrat,
//             },
//           });
//           updatedCount++;
//         }
//       }

for (const operation of pendingOperations) {
  const [hours, minutes] = operation.timeStrat.split(':').map(Number);
  const startDateTime = new Date(operation.dateStart);
  startDateTime.setHours(hours, minutes, 0, 0);

  const minutesDiff = differenceInMinutes(now, startDateTime);
  
  // 🛡️ PERÍODO DE GRACIA: Verificar si la operación fue creada hace menos de 3 minutos
  // ✅ CORREGIDO: Parámetros en orden correcto (fecha_reciente - fecha_antigua)
  const minutesSinceCreation = differenceInMinutes(now, operation.createAt);
  const isInGracePeriod = minutesSinceCreation >= 0 && minutesSinceCreation < 3;
  
  if (isInGracePeriod) {
    this.logger.debug(`⏳ Operación ${operation.id} en período de gracia (creada hace ${minutesSinceCreation} minutos), saltando activación automática`);
    gracePeriodCount++; // 📊 Incrementar contador
    continue; // Saltar esta operación y continuar con la siguiente
  }
  
  // ⚠️ DEBUG: Log operaciones con tiempo negativo para detectar problemas de zona horaria
  if (minutesSinceCreation < 0) {
    this.logger.warn(`🚨 Operación ${operation.id} con tiempo de creación incorrecto: ${minutesSinceCreation} minutos. createAt: ${operation.createAt.toISOString()}, now: ${now.toISOString()}`);
  }
  
  // ✅ NUEVA LÓGICA: Determinar si debe cambiar a INPROGRESS
  let shouldUpdate = false;
  let reason = '';
  
  // Comparar fechas sin hora para determinar el día
  const operationDate = new Date(operation.dateStart.getFullYear(), operation.dateStart.getMonth(), operation.dateStart.getDate());
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  
  if (operationDate.getTime() < todayDate.getTime()) {
    // ✅ CASO 1: Operación de días anteriores - activar inmediatamente (pero respetando período de gracia)
    shouldUpdate = true;
    reason = 'previous day operation';
  } 
  else if (operationDate.getTime() === todayDate.getTime()) {
    // ✅ CASO 2: Operación de hoy - esperar 1 minuto después de la hora programada
    if (minutesDiff >= 1) {
      shouldUpdate = true;
      reason = 'scheduled time passed';
    } 
   
  }
  else {
    // ✅ CASO 3: Operación de días futuros - no activar
    // this.logger.debug(`📅 Operation ${operation.id} scheduled for future date (${operation.dateStart.toISOString().split('T')[0]}) - keeping PENDING`);
  }

  if (shouldUpdate) {
    this.logger.debug(`🚀 Actualizando operación ${operation.id} a INPROGRESS (razón: ${reason})`);
    
    // 🔄 OPTIMIZACIÓN: Usar transacción para operaciones atómicas
    await this.prisma.$transaction(async (tx) => {
      // Actualizar el estado a INPROGRESS
      await tx.operation.update({
        where: { id: operation.id },
        data: { status: 'INPROGRESS' },
      });

      // Actualizar la fecha y hora de inicio en la tabla intermedia
      await tx.operation_Worker.updateMany({
        where: {
          id_operation: operation.id,
          dateEnd: null,
          timeEnd: null,
        },
        data: {
          dateStart: operation.dateStart,
          timeStart: operation.timeStrat,
        },
      });
    });
    
    updatedCount++;
  }
}

      if (updatedCount > 0) {
        this.logger.log(`✅ ${updatedCount} operaciones actualizadas a estado INPROGRESS`);
      }

      // � Log informativo sobre período de gracia
      if (gracePeriodCount > 0) {
        this.logger.debug(`⏳ ${gracePeriodCount} operaciones saltadas por período de gracia (< 3 minutos)`);
      }

      // 🗂️ Actualizar caché después del procesamiento
      this.lastProcessedTime = now;
      this.lastPendingCount = pendingCount - updatedCount;

      return { 
        updatedCount, 
        processed: pendingOperations.length,
        totalPending: pendingCount,
        gracePeriodOperations: gracePeriodCount,
        consecutiveEmptyRuns: this.consecutiveEmptyRuns,
        willEnterDeepSleep: false,
        hasMore: pendingCount > pendingOperations.length 
      };
    } catch (error) {
      this.logger.error('❌ Error crítico updating operations:', error);
      
      // 📊 MONITOREO: Reportar estadísticas de error
      const errorStats = {
        error: error.message,
        timestamp: new Date().toISOString(),
        pendingCount: 0,
        consecutiveEmptyRuns: this.consecutiveEmptyRuns,
        willEnterDeepSleep: false
      };
      
      // No lanzar el error, solo loggearlo para evitar que el servidor se caiga
      return { updatedCount: 0, ...errorStats };
    }
  }

  async updateCompletedOperations() {
    try {
      // this.logger.debug('Checking for operations to update to COMPLETED...');

      // Usar hora colombiana en lugar de hora del servidor
      const now = getColombianDateTime();

      // Crear fecha de inicio (hoy a medianoche hora colombiana)
      const startOfDay = getColombianStartOfDay(now);

      // Crear fecha de fin (mañana a medianoche hora colombiana)
      const endOfDay = getColombianEndOfDay(now);

      // this.logger.debug(`Colombian time now: ${now.toISOString()}`);
      // this.logger.debug(
      //   `Searching operations for date: ${startOfDay.toISOString()} to ${endOfDay.toISOString()}`,
      // );

      // Buscar todas las operaciones con estado INPROGRESS para hoy que tengan fecha de finalización
      const inProgressOperations = await this.prisma.operation.findMany({
        where: {
          dateEnd: {
            gte: startOfDay, // Mayor o igual que hoy a medianoche (hora colombiana)
            lt: endOfDay, // Menor que mañana a medianoche (hora colombiana)
          },
          status: 'INPROGRESS',
          timeEnd: {
            not: null, // Asegurarse de que tienen una hora de finalización
          },
        },
      });

      // this.logger.debug(
      //   `Found ${inProgressOperations.length} in-progress operations with end time`,
      // );

      let updatedCount = 0;
      let releasedWorkersCount = 0;
      let billsCreatedCount = 0;

      for (const operation of inProgressOperations) {
        // Verificar que tenemos todos los datos necesarios
        if (!operation.dateEnd || !operation.timeEnd) {
          // this.logger.warn(
          //   `Operation ${operation.id} has missing end date or time`,
          // );
          continue;
        }

        // Crear la fecha de finalización completa combinando dateEnd y timeEnd
        // const dateEndStr = operation.dateEnd.toISOString().split('T')[0];
        // const endDateTime = new Date(`${dateEndStr}T${operation.timeEnd}`);

        const [hours, minutes] = operation.timeEnd.split(':').map(Number);
const endDateTime = new Date(operation.dateEnd);
endDateTime.setHours(hours, minutes, 0, 0);

        // Verificar si han pasado 10 minutos desde la hora de finalización (usando hora colombiana)
        const minutesDiff = differenceInMinutes(now, endDateTime);
        // this.logger.debug(
        //   `Operation ${operation.id}: ${minutesDiff} minutes since end time (Colombian time)`,
        // );

        // Si han pasado 1 minutos desde la hora de finalización
        if (minutesDiff >= 1) {
          // Obtener fecha y hora de finalización en zona horaria colombiana
          const colombianEndTime = getColombianDateTime();
          const colombianTimeString = getColombianTimeString();

          // Paso 1: Obtener los trabajadores de esta operación desde la tabla intermedia
          const operationWorkers = await this.prisma.operation_Worker.findMany({
            where: { id_operation: operation.id },
            select: { 
              worker: true,
              id_worker: true, 
              id_group: true 
        },
          });

          const workerIds = operationWorkers.map((ow) => ow.id_worker);
          // this.logger.debug(
          //   `Found ${workerIds.length} workers for operation ${operation.id}`,
          // );

          // Paso 2: Actualizar el estado de los trabajadores a AVALIABLE
          if (workerIds.length > 0) {
            const result = await this.prisma.worker.updateMany({
              where: {
                id: { in: workerIds },
                status: { not: 'AVALIABLE' },
              },
              data: { status: 'AVALIABLE' },
            });

            releasedWorkersCount += result.count;
            // this.logger.debug(
            //   `Released ${result.count} workers from operation ${operation.id}`,
            // );
          }
// Paso 3: Calcular op_duration antes de actualizar a COMPLETED
          let opDuration = 0;
          if (operation.dateStart && operation.timeStrat && operation.dateEnd && operation.timeEnd) {
            const start = new Date(operation.dateStart);
            const [sh, sm] = operation.timeStrat.split(':').map(Number);
            start.setHours(sh, sm, 0, 0);

            const end = new Date(operation.dateEnd);
            const [eh, em] = operation.timeEnd.split(':').map(Number);
            end.setHours(eh, em, 0, 0);

            const diffMs = end.getTime() - start.getTime();
            opDuration = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100; // 2 decimales
            opDuration = opDuration > 0 ? opDuration : 0;
            
            // this.logger.debug(
            //   `Calculated op_duration for operation ${operation.id}: ${opDuration} hours`,
            // );
          }

          // Paso 4: Actualizar el estado de la operación a COMPLETED con op_duration
          const response = await this.prisma.operation.update({
            where: { id: operation.id },
            data: { status: 'COMPLETED',
             op_duration: opDuration
             },
          });

          // Paso 5: Crear factura automáticamente clalculando compensatorio
         try {
            // // Obtener grupos únicos de la operación con información completa
            // const operationWorkersWithDetails = await this.prisma.operation_Worker.findMany({
            //   where: { id_operation: operation.id },
            //   include: {
            //     worker: true,
            //   },
            // });

            const uniqueGroups = [
              ...new Set(operationWorkers.map((ow) => ow.id_group)),
            ];

            //this.logger.debug(
            //   `Creando factura para operación ${operation.id} con op_duration: ${opDuration} horas`,
            // );

            // Crear grupos para la factura con op_duration para calcular compensatorio
            const billGroups = uniqueGroups.map((groupId) => {
              const groupWorkers = operationWorkers.filter((ow) => ow.id_group === groupId);
              
              return {
                id: String(groupId),
                amount: 0,
                group_hours: new Decimal(opDuration), // ✅ USAR op_duration REAL EN LUGAR DE 0
                pays: groupWorkers.map((ow) => ({
                  id_worker: ow.id_worker,
                  pay: 0,
                })),
                paysheetHoursDistribution: {
                  HOD: 0,
                  HON: 0,
                  HED: 0,
                  HEN: 0,
                  HFOD: 0,
                  HFON: 0,
                  HFED: 0,
                  HFEN: 0,
                },
                billHoursDistribution: {
                  HOD: 0,
                  HON: 0,
                  HED: 0,
                  HEN: 0,
                  HFOD: 0,
                  HFON: 0,
                  HFED: 0,
                  HFEN: 0,
                },
              };
            });

            const createBillDto = {
              id_operation: operation.id,
              groups: billGroups,
            };

            // this.logger.debug(
            //  `DTO de factura con op_duration: ${JSON.stringify({ op_duration: opDuration, groupsCount: billGroups.length })}`,
            // );

            // Llamar al servicio de facturación (userId 1 para sistema automático)
            await this.billService.create(createBillDto, 1);

            billsCreatedCount++;
            // this.logger.debug(
            //   `Factura creada automáticamente para operación ${operation.id} con compensatorio calculado`,
            // );
          } catch (billError) {
            this.logger.error(
            `Error creando factura para operación ${operation.id}:`,
              billError,
            );
            // No interrumpir el proceso por error en facturación
          }

          // Paso 4: Actualizar la fecha y hora de finalización en la tabla intermedia (con hora colombiana)
          await this.prisma.operation_Worker.updateMany({
            where: {
              id_operation: operation.id,
              dateEnd: null,
              timeEnd: null,
            },
            data: {
              dateEnd: colombianEndTime, // Usar hora colombiana
              timeEnd: colombianTimeString, // Usar hora colombiana en formato HH:MM
            },
          });

          //paso 5: actulizar el estado de cliente programming a COMPLETED
          if (response.id_clientProgramming) {
            await this.prisma.clientProgramming.update({
              where: { id: response.id_clientProgramming },
              data: { status: 'COMPLETED' },
            });
            // this.logger.debug(
            //   `Updated client programming ${response.id_clientProgramming} to COMPLETED status`,
            // );
          }

          updatedCount++;
        }
      }

      // if (updatedCount > 0) {
      //   this.logger.debug(
      //     `Updated ${updatedCount} operations to COMPLETED status`,
      //   );
      // }

      return { updatedCount,
        billsCreatedCount,
        releasedWorkersCount
       };
    } catch (error) {
      this.logger.error('❌ Error crítico updating completed operations:', error);
      // No lanzar el error, solo loggearlo para evitar que el servidor se caiga
      return { 
        updatedCount: 0,
        billsCreatedCount: 0,
        releasedWorkersCount: 0,
        error: error.message 
      };
    }
  }
}
