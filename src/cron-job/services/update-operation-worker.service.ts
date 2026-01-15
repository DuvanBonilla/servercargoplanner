import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UpdateOperationWorkerService {
  private readonly logger = new Logger(UpdateOperationWorkerService.name);

  constructor(private prisma: PrismaService) {}

  /**
   * Actualiza el estado de los trabajadores según su programación
   * Garantizando el uso de la zona horaria colombiana
   */
  async updateWorkersScheduleState(): Promise<void> {
    try {
      // this.logger.log('Iniciando actualización de estado de trabajadores según programación');

      // Obtener fecha y hora actual en zona horaria de Colombia
      const colombiaTime = new Date(new Date().toLocaleString('en-US', {timeZone: 'America/Bogota'}));
      
      // Formatear fechas para logs con zona horaria colombiana
      const localTimeStr = new Intl.DateTimeFormat('es-CO', { 
        timeZone: 'America/Bogota', 
        hour: '2-digit', 
        minute: '2-digit',
        second: '2-digit',
        hour12: false 
      }).format(colombiaTime);
      
      const localDateStr = new Intl.DateTimeFormat('es-CO', {
        timeZone: 'America/Bogota',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      }).format(colombiaTime);
      
      // Obtener fecha actual en formato YYYY-MM-DD usando la zona horaria colombiana
      // Formato adecuado para comparaciones de fechas
      const today = colombiaTime.toISOString().split('T')[0];
      
      // Calcular fecha de mañana en zona horaria colombiana
      const tomorrow = new Date(colombiaTime);
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowString = tomorrow.toISOString().split('T')[0];
      
      // this.logger.debug(`Hora actual Colombia: ${localDateStr} ${localTimeStr}`);
      // this.logger.debug(`Fecha de hoy: ${today}, fecha de mañana: ${tomorrowString}`);
      
      // IMPORTANTE: Solo traer operaciones en INPROGRESS
      const activeOperations = await this.prisma.operation.findMany({
        where: {
          status: 'INPROGRESS',
        },
        select: {
          id: true,
          dateStart: true,
          timeStrat: true, // Mantener nombre original con typo
          dateEnd: true,
          timeEnd: true,
          status: true,
        },
      });
      
      // Filtrar operaciones manualmente para garantizar que sean de hoy o mañana
      const todayOperations = activeOperations.filter(op => {
        if (!op.dateStart) return false;
        
        // Convertir fecha de la operación a formato YYYY-MM-DD
        const opStartDate = new Date(op.dateStart).toISOString().split('T')[0];
        const opEndDate = op.dateEnd ? new Date(op.dateEnd).toISOString().split('T')[0] : null;
        
        // Una operación es relevante si:
        // - Su fecha de inicio es HOY, O
        // - Su fecha de fin es HOY o MAÑANA
        return (opStartDate === today || opEndDate === today || opEndDate === tomorrowString);
      });
      
      // this.logger.debug(`Encontradas ${todayOperations.length} operaciones activas para hoy/mañana: ${todayOperations.map(op => op.id).join(', ')}`);

      // Si no hay operaciones activas para hoy, no es necesario continuar
      if (todayOperations.length === 0) {
        // this.logger.log('No hay operaciones en progreso para el rango de fechas actual. No se realizarán cambios.');
        return;
      }

      // Crear conjunto de IDs de operaciones activas
      const activeOperationIds = new Set(todayOperations.map(op => op.id));

      // Mantener registros de trabajadores ya procesados en este ciclo
      const processedWorkers = new Set<number>();
      
      // IMPORTANTE: Obtener información completa de los trabajadores para estas operaciones
      const operationWorkers = await this.prisma.operation_Worker.findMany({
        where: {
          id_operation: {
            in: Array.from(activeOperationIds),
          },
        },
        include: {
          worker: true,
        },
      });

      // this.logger.debug(`Encontrados ${operationWorkers.length} trabajadores para evaluar en operaciones de hoy/mañana`);

      // Listas para trabajadores a actualizar y contadores para omisiones
      const workersToAssign: number[] = [];
      const workersToRelease: number[] = [];
      
      // Contadores para los distintos tipos de omisiones
      const omissions = {
        datosIncompletos: 0,
        yaAsignados: 0,
        estadoInvalido: 0,
        yaProcesados: 0
      };
      
      // Para trabajadores que no serán asignados por tiempo
      const outOfTimeWindow: { id: number, elapsed: number }[] = [];
      
      // Trabajadores no liberados 
      const notReleased: { id: number, endDate: string, endTime: string }[] = [];
      
      // Componentes de fecha y hora actual (para comparaciones) en zona horaria Colombia
      const currentHour = colombiaTime.getHours();
      const currentMinute = colombiaTime.getMinutes();
      const currentTimeInMinutes = currentHour * 60 + currentMinute;
      
      // 1. PASO UNO: PROCESAR LIBERACIONES
      // Primero liberamos trabajadores que hayan terminado su turno
      for (const ow of operationWorkers) {
        // Verificación básica
        if (!ow.worker || !ow.dateEnd || !ow.timeEnd) {
          omissions.datosIncompletos++;
          continue;
        }
        
        // VALIDACIÓN: Solo procesar trabajadores que están actualmente ASSIGNED
        if (ow.worker.status !== 'ASSIGNED') {
          omissions.yaAsignados++;
          continue;
        }
        
        // Obtener fecha y hora de fin del trabajador
        const endDate = new Date(ow.dateEnd);
        const endDateString = endDate.toISOString().split('T')[0];
        
        // Extraer hora y minutos del string de hora (formato: "HH:MM")
        const [endHour, endMinute] = ow.timeEnd.split(':').map(Number);
        const endTimeInMinutes = endHour * 60 + endMinute;
        
        // Determinar si debe ser liberado
        let shouldRelease = false;
        
        // Caso 1: La fecha de fin ya pasó completamente (es anterior a hoy)
        if (endDateString < today) {
          shouldRelease = true;
        } 
        // Caso 2: Es hoy pero la hora programada de fin ya pasó
        else if (endDateString === today && currentTimeInMinutes > endTimeInMinutes) {
          shouldRelease = true;
        }
        
        if (shouldRelease) {
          workersToRelease.push(ow.id_worker);
          processedWorkers.add(ow.id_worker);
          // this.logger.debug(`Trabajador ${ow.id_worker} será LIBERADO. Fin programado: ${endDateString} ${ow.timeEnd}`);
        } else {
          // Agregar a la lista de no liberados sin generar log ahora
          notReleased.push({
            id: ow.id_worker,
            endDate: endDateString,
            endTime: ow.timeEnd
          });
        }
      }
      
      // 2. PASO DOS: PROCESAR ASIGNACIONES
      // Ahora asignar trabajadores que deban comenzar, respetando la regla de 10 minutos
      for (const ow of operationWorkers) {
        // Verificación básica
        if (!ow.worker || !ow.dateStart || !ow.timeStart) {
          omissions.datosIncompletos++;
          continue;
        }
        
        // No procesar trabajadores ya gestionados en este ciclo
        if (processedWorkers.has(ow.id_worker)) {
          omissions.yaProcesados++;
          continue;
        }
        
        // VALIDACIÓN: No procesar trabajadores que ya estén ASSIGNED
        if (ow.worker.status === 'ASSIGNED') {
          omissions.yaAsignados++;
          continue;
        }
        
        // VALIDACIÓN: No procesar trabajadores con estado inválido
        if (ow.worker.status !== 'AVALIABLE') {
          omissions.estadoInvalido++;
          continue;
        }
        
        // Obtener fecha y hora de inicio del trabajador
        const startDate = new Date(ow.dateStart);
        const startDateString = startDate.toISOString().split('T')[0];
        
        // Extraer hora y minutos del string de hora (formato: "HH:MM")
        const [startHour, startMinute] = ow.timeStart.split(':').map(Number);
        const startTimeInMinutes = startHour * 60 + startMinute;
        
        // Determinar si debe ser asignado (solo para HOY)
        let shouldAssign = false;
        let minutesElapsed = 0;
        
        // Solo considerar asignaciones para el día actual
        if (startDateString === today) {
          // Calcular minutos transcurridos desde la hora programada
          minutesElapsed = currentTimeInMinutes - startTimeInMinutes;
          
          // REGLA DE 10 MINUTOS: Asignar solo si han pasado entre 0 y 10 minutos desde la hora programada
          if (minutesElapsed >= 0 && minutesElapsed <= 10) {
            shouldAssign = true;
          }
        }
        
        if (shouldAssign) {
          workersToAssign.push(ow.id_worker);
          processedWorkers.add(ow.id_worker);
          // this.logger.debug(`Trabajador ${ow.id_worker} será ASIGNADO. Hora: ${ow.timeStart}, minutos transcurridos: ${minutesElapsed}`);
        } else if (minutesElapsed > 10) {
          // Agregar a la lista de trabajadores fuera de tiempo sin generar log ahora
          outOfTimeWindow.push({
            id: ow.id_worker,
            elapsed: minutesElapsed
          });
        }
      }

      // LOGS RESUMIDOS
      // Log resumido de omisiones
      if (omissions.datosIncompletos > 0 || omissions.yaAsignados > 0 || 
          omissions.estadoInvalido > 0 || omissions.yaProcesados > 0) {
        
        const omissionDetails: string[] = [];
        if (omissions.datosIncompletos > 0) omissionDetails.push(`${omissions.datosIncompletos} por datos incompletos`);
        if (omissions.yaAsignados > 0) omissionDetails.push(`${omissions.yaAsignados} ya asignados/no asignados`);
        if (omissions.estadoInvalido > 0) omissionDetails.push(`${omissions.estadoInvalido} con estado inválido`);
        if (omissions.yaProcesados > 0) omissionDetails.push(`${omissions.yaProcesados} ya procesados en este ciclo`);
        
        // this.logger.debug(`Trabajadores omitidos: ${omissionDetails.join(', ')}`);
      }
      
      // Log resumido de trabajadores fuera de la ventana de tiempo
      if (outOfTimeWindow.length > 0) {
        const sampleSize = Math.min(3, outOfTimeWindow.length);
        // this.logger.debug(
        //   `${outOfTimeWindow.length} trabajadores NO asignados por estar fuera de la ventana de 10 minutos. ` +
        //   `Ejemplos: ${outOfTimeWindow.slice(0, sampleSize).map(w => `ID ${w.id} (${w.elapsed} min)`).join(', ')}...`
        // );
      }
      
      // Log resumido de trabajadores que no serán liberados
      if (notReleased.length > 0) {
        const sampleSize = Math.min(3, notReleased.length);
        // this.logger.debug(
        //   `${notReleased.length} trabajadores NO liberados porque aún no ha pasado su hora de fin. ` +
        //   `Ejemplos: ${notReleased.slice(0, sampleSize).map(w => `ID ${w.id} (fin: ${w.endTime})`).join(', ')}...`
        // );
      }

      // Aplicar cambios en la base de datos
      if (workersToRelease.length > 0) {
        await this.prisma.worker.updateMany({
          where: { id: { in: workersToRelease } },
          data: { status: 'AVALIABLE' },
        });
        // this.logger.log(
        //   `${workersToRelease.length} trabajadores actualizados a AVALIABLE: ${workersToRelease.join(', ')}`
        // );
      }
      //  else {
      //   this.logger.log('No hay trabajadores para liberar en este ciclo');
      // }

      if (workersToAssign.length > 0) {
        await this.prisma.worker.updateMany({
          where: { id: { in: workersToAssign } },
          data: { status: 'ASSIGNED' },
        });
        // this.logger.log(
        //   `${workersToAssign.length} trabajadores actualizados a ASSIGNED: ${workersToAssign.join(', ')}`
        // );
      } 
      // else {
      //   this.logger.log('No hay trabajadores para asignar en este ciclo');
      // }

      // this.logger.log('Actualización de estado de trabajadores completada');
    } catch (error) {
      this.logger.error('Error actualizando estado de trabajadores:', error);
      throw new Error(`Error en actualización de programación: ${error.message}`);
    }
  }
}