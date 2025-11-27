import { Injectable } from '@nestjs/common';
import { CreateFeedingDto } from './dto/create-feeding.dto';
import { UpdateFeedingDto } from './dto/update-feeding.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ValidationService } from 'src/common/validation/validation.service';
import { FilterWorkerFeedingDto } from './dto/filter-worker-feeding.dto';
import { PaginationFeedingService } from 'src/common/services/pagination/feeding/pagination-feeding.service';

@Injectable()
export class FeedingService {
  constructor(
    private prisma: PrismaService,
    private validation: ValidationService,
    private paginationService: PaginationFeedingService,
  ) {}

  /**
 * Determina qué comidas están disponibles basado en el horario de trabajo del grupo
 */
private getAvailableMealTypes(operationDateStart: Date, operationTimeStart: string, operationTimeEnd?: string | null): string[] {
  const now = new Date();
  
  // Crear la fecha y hora de inicio de la operación
  const [startHours, startMinutes] = operationTimeStart.split(':').map(Number);
  const operationStart = new Date(operationDateStart);
  operationStart.setUTCHours(startHours, startMinutes, 0, 0);
  
  // Crear la fecha y hora de fin de la operación (si existe)
  let operationEnd: Date | null = null;
  if (operationTimeEnd && operationTimeEnd.trim() !== '') {  // ✅ VALIDACIÓN MEJORADA
    try {
      const [endHours, endMinutes] = operationTimeEnd.split(':').map(Number);
      operationEnd = new Date(operationDateStart);
      operationEnd.setUTCHours(endHours, endMinutes, 0, 0);
    } catch (error) {
      console.log(`⚠️ Error parseando timeEnd: ${operationTimeEnd}`);
      operationEnd = null;
    }
  }
  
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const operationStartDate = new Date(operationStart.getUTCFullYear(), operationStart.getUTCMonth(), operationStart.getUTCDate());
  
  const availableMeals: string[] = [];
  
  // Horarios de comidas en minutos desde medianoche
  const mealSchedule = {
    BREAKFAST: { start: 6 * 60, end: 7 * 60 },   // 6:00 AM - 7:00 AM
    LUNCH: { start: 12 * 60, end: 13 * 60 },     // 12:00 PM - 1:00 PM  
    DINNER: { start: 18 * 60, end: 19 * 60 },    // 6:00 PM - 7:00 PM
    SNACK: { start: 23 * 60, end: 24 * 60 },     // 11:00 PM - 12:00 AM
  };

  if (todayDate.getTime() === operationStartDate.getTime()) {
    console.log('🔍 ES PRIMER DÍA - evaluando comidas por horario de trabajo');
    
    const startTotalMinutes = operationStart.getUTCHours() * 60 + operationStart.getUTCMinutes();
    const endTotalMinutes = operationEnd ? (
      operationEnd.getUTCHours() * 60 + operationEnd.getUTCMinutes()) : (24 * 60);
    const currentTotalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    
    console.log(`⏰ Horario trabajo: ${Math.floor(startTotalMinutes/60)}:${(startTotalMinutes%60).toString().padStart(2,'0')} - ${Math.floor(endTotalMinutes/60)}:${(endTotalMinutes%60).toString().padStart(2,'0')}`);
    console.log(`⏰ Hora actual: ${Math.floor(currentTotalMinutes/60)}:${(currentTotalMinutes%60).toString().padStart(2,'0')}`);
    
    // Verificar cada comida contra el horario de trabajo
    Object.entries(mealSchedule).forEach(([mealType, schedule]) => {
      // Verificar si hay superposición entre horario de trabajo y horario de comida
      const workStartsBeforeMealEnds = startTotalMinutes < schedule.end;
      const workEndsAfterMealStarts = endTotalMinutes > schedule.start;
      const hasOverlap = workStartsBeforeMealEnds && workEndsAfterMealStarts;
      
      // Verificar si estamos en horario de comida actualmente
      const isCurrentlyMealTime = currentTotalMinutes >= schedule.start && currentTotalMinutes <= schedule.end;
      
      console.log(`🍽️ ${mealType}:`);
      console.log(`   - Horario comida: ${Math.floor(schedule.start/60)}:${(schedule.start%60).toString().padStart(2,'0')} - ${Math.floor(schedule.end/60)}:${(schedule.end%60).toString().padStart(2,'0')}`);
      console.log(`   - ¿Trabajo se superpone con comida? ${hasOverlap}`);
      console.log(`   - ¿Estamos en horario de comida? ${isCurrentlyMealTime}`);
      
      if (hasOverlap && isCurrentlyMealTime) {
        availableMeals.push(mealType);
        console.log(`✅ ${mealType} disponible`);
      } else {
        console.log(`❌ ${mealType} NO disponible`);
      }
    });
    
  } else if (todayDate.getTime() > operationStartDate.getTime()) {
    // Para días posteriores, usar lógica normal por hora actual
    const currentHour = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinutes;
    
    if (currentTotalMinutes >= 6 * 60 && currentTotalMinutes <= 7 * 60) {
      availableMeals.push('BREAKFAST');
    }
    if (currentTotalMinutes >= 12 * 60 && currentTotalMinutes <= 13 * 60) {
      availableMeals.push('LUNCH');
    }
    if (currentTotalMinutes >= 18 * 60 && currentTotalMinutes <= 19 * 60) {
      availableMeals.push('DINNER');
    }
    if (currentTotalMinutes >= 23 * 60 && currentTotalMinutes <= 24 * 60) {
      availableMeals.push('SNACK');
    }
  }
  
  return availableMeals;
}

  async create(createFeedingDto: CreateFeedingDto, id_site?: number) {
    try {
      const validation = await this.validation.validateAllIds({
        workerIds: [createFeedingDto.id_worker],
        id_operation: createFeedingDto.id_operation,
      });
      if (validation && 'status' in validation && validation.status === 404) {
        return validation;
      }

      if (id_site !== undefined) {
        const workerValidation = validation?.existingWorkers?.[0];
        if (workerValidation && workerValidation.id_site !== id_site) {
          return {
            message: 'Not authorized to create feeding for this worker',
            status: 409,
          };
        }
        const operationValidation = validation['operation'].id_site;
        if (operationValidation && operationValidation !== id_site) {
          return {
            message: 'Not authorized to create feeding for this operation',
            status: 409,
          };
        }
      }

      // const operation = validation['operation'];
      // const availableMealTypes = this.getAvailableMealTypes(operation.dateStart, operation.timeStrat);


// En el método create, línea ~185:

const operation = validation['operation'];

// ✅ OBTENER LA OPERACIÓN COMPLETA CON timeEnd
const fullOperation = await this.prisma.operation.findUnique({
  where: { id: createFeedingDto.id_operation },
  select: { dateStart: true, timeStrat: true, timeEnd: true }
});
if (!fullOperation) {
  return { message: 'Operation not found', status: 404 };
}

// ✅ USAR LA OPERACIÓN COMPLETA
const availableMealTypes = this.getAvailableMealTypes(
  fullOperation.dateStart, 
  fullOperation.timeStrat,
  fullOperation.timeEnd
);


      // Validar horario solo si la comida NO es una faltante anterior
      if (!availableMealTypes.includes(createFeedingDto.type)) {
        // Consultar comidas faltantes anteriores
        const missingMeals = await this.getMissingMealsForOperation(createFeedingDto.id_operation);
        const isMissingMeal = missingMeals.some(worker =>
          worker.workerId === createFeedingDto.id_worker &&
          worker.missingMeals.includes(createFeedingDto.type)
        );

        if (!isMissingMeal) {
          const feedingTypeNames = {
            BREAKFAST: 'desayuno',
            LUNCH: 'almuerzo',
            DINNER: 'cena',
            SNACK: 'refrigerio',
          };
          return {
            message: `El ${feedingTypeNames[createFeedingDto.type]} no está disponible en este momento. Comidas disponibles: ${availableMealTypes.map(type => feedingTypeNames[type]).join(', ')}`,
            status: 409,
          };
        }
        // Si es una comida faltante, permitir registrar aunque no esté en horario
      }

      // **VALIDACIÓN EXISTENTE**: Verificar si el trabajador ya tiene una alimentación del mismo tipo hoy
      const today = new Date();
      const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

      const existingFeeding = await this.prisma.workerFeeding.findFirst({
        where: {
          id_worker: createFeedingDto.id_worker,
          type: createFeedingDto.type,
          dateFeeding: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      });

      if (existingFeeding) {
        const feedingTypeNames = {
          BREAKFAST: 'desayuno',
          LUNCH: 'almuerzo',
          DINNER: 'cena',
          SNACK: 'refrigerio',
        };

        return {
          message: `El trabajador ya tiene registrado un ${feedingTypeNames[createFeedingDto.type]} para el día de hoy`,
          status: 409,
        };
      }

      // Separar la propiedad forceMissingMeal si existe
      const { forceMissingMeal, ...feedingData } = createFeedingDto;
      const response = await this.prisma.workerFeeding.create({
        data: {
          ...feedingData,
          id_worker: createFeedingDto.id_worker,
          id_operation: createFeedingDto.id_operation,
          // Si no viene dateFeeding, usar la fecha actual
          dateFeeding: createFeedingDto.dateFeeding
            ? new Date(createFeedingDto.dateFeeding)
            : new Date(),
        },
      });
      if (!response) {
        return { message: 'Feeding not created', status: 404 };
      }
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }

  /**
   * Método público para obtener las comidas disponibles para una operación
   */
  async getAvailableMealsForOperation(operationId: number) {
    try {
      const operation = await this.prisma.operation.findUnique({
        where: { id: operationId },
        select: { 
          dateStart: true, 
          timeStrat: true, 
          timeEnd: true,
          status: true 
        },
      });

      if (!operation) {
        return { message: 'Operation not found', status: 404 };
      }

       // ✅ OBTENER COMIDAS DISPONIBLES POR HORARIO
    const availableMealTypes = this.getAvailableMealTypes(
      operation.dateStart, 
      operation.timeStrat, 
      operation.timeEnd
    );

        // ✅ AGREGAR COMIDAS FALTANTES COMO DISPONIBLES PARA REGISTRO
    const missingMeals = await this.getMissingMealsForOperation(operationId);
    const allMissingMealTypes = [...new Set(missingMeals.flatMap(worker => worker.missingMeals))];
    
    // ✅ COMBINAR: comidas de horario + comidas faltantes
    const allAvailableMeals = [...new Set([...availableMealTypes, ...allMissingMealTypes])];
    
    console.log(`🍽️ [DEBUG] Op ${operationId}:`);
    console.log(`   - Por horario: [${availableMealTypes.join(', ')}]`);
    console.log(`   - Faltantes: [${allMissingMealTypes.join(', ')}]`);
    console.log(`   - Total disponibles: [${allAvailableMeals.join(', ')}]`);
      
      const feedingTypeNames = {
        BREAKFAST: 'desayuno',
        LUNCH: 'almuerzo',
        DINNER: 'cena',
        SNACK: 'refrigerio',
      };

      // Crear la fecha y hora de inicio completa para la respuesta
      const [hours, minutes] = operation.timeStrat.split(':').map(Number);
      const operationStartDateTime = new Date(operation.dateStart);
      operationStartDateTime.setHours(hours, minutes, 0, 0);

      return {
        availableMeals: availableMealTypes,
        availableMealNames: availableMealTypes.map(type => feedingTypeNames[type]),
        operationStartDate: operation.dateStart,
        operationStartTime: operation.timeStrat,
        operationEndTime: operation.timeEnd, 
        operationStartDateTime: operationStartDateTime,
        currentTime: new Date(),
         missingMealsIncluded: allMissingMealTypes,
      };
    } catch (error) {
      throw new Error(error);
    }
  }

  // async findAll(id_site?: number) {
  //   try {
  //     const response = await this.prisma.workerFeeding.findMany({
  //       where: { worker: { id_site } },
  //     });
  //     if (!response || response.length === 0) {
  //       return { message: 'No worker feeding records found', status: 404 };
  //     }
  //     return response;
  //   } catch (error) {
  //     throw new Error(error);
  //   }
  // }

 async findAll(id_site?: number, id_subsite?: number | null) {
  try {
    const whereClause: any = {};

    // Siempre filtra por sitio si viene
    if (id_site) {
      whereClause['worker'] = { id_site };
    }

    // Solo filtra por subsede si es un número válido
    if (typeof id_subsite === 'number' && !isNaN(id_subsite)) {
      whereClause['worker'] = {
        ...(whereClause['worker'] || {}),
        id_subsite,
      };
    }

    const response = await this.prisma.workerFeeding.findMany({
      where: whereClause,
      include: {
        operation: {
          select: {
            id: true,
            task: {
              select: {
                id: true,
                name: true,
              }
            }
          }
        },
        worker: {
          select: {
            id: true,
            name: true,
          }
        },
        user: {
          select: {
            id: true,
            name: true,
          } 
      }
     }
    });
    if (!response || response.length === 0) {
      return { message: 'No worker feeding records found', status: 404 };
    }
    return response.map(feeding => ({
      ...feeding,
      serviceName: feeding.operation?.task?.name || null,
      workerName: feeding.worker?.name || null,
      userName: feeding.user?.name || null,
    }));
  } catch (error) {
    throw new Error(error.message || String(error));
  }
}

  async findOne(id: number, id_site?: number) {
    try {
      const response = await this.prisma.workerFeeding.findUnique({
        where: {
          id,
          worker: {
            id_site,
          }, 
        }, 
           include: {
        operation: {
          select: {
            id: true,
            task: {
              select: {
                id: true,
                name: true,
              }
            }
          }
        },
        worker: {
          select: {
            id: true,
            name: true,
          }
        },
        user: {
          select: {
            id: true,
            name: true,
          }
        }     
      }
      });
      if (!response || Object.keys(response).length === 0) {
        return { message: 'Feeding not found', status: 404 };
      }
      // return response;
      return {
      ...response,
      serviceName: response.operation?.task?.name || null,
      workerName: response.worker?.name || null,
      userName: response.user?.name || null,
    };
    } catch (error) {
      throw new Error(error);
    }
  }

  async findAllPaginated(
    page: number = 1,
    limit: number = 10,
    filters?: FilterWorkerFeedingDto,
    activatePaginated: boolean = true,
  ) {
    try {
      // Usar el servicio de paginación para feeding
      const paginatedResponse =
        await this.paginationService.paginateWorkerFeeding({
          prisma: this.prisma,
          page,
          limit,
          filters,
          activatePaginated: activatePaginated === false ? false : true,
        });

      // Si no hay resultados, mantener el formato de respuesta de error
      if (paginatedResponse.items.length === 0) {
        return {
          message: 'No worker feeding records found for the requested page',
          status: 404,
          pagination: paginatedResponse.pagination,
          items: [],
          nextPages: [],
        };
      }

      return paginatedResponse;
    } catch (error) {
      console.error('Error finding worker feeding with pagination:', error);
      throw new Error(error.message);
    }
  }

  async findByOperation(id_operation: number, id_site?: number) {
    try {
      const validation = await this.validation.validateAllIds({
        id_operation,
      });
      if (validation && 'status' in validation && validation.status === 404) {
        return validation;
      }
      const response = await this.prisma.workerFeeding.findMany({
        where: {
          id_operation,
          worker: {
            id_site,
          },
        },
         include: {
        operation: {
          select: {
            id: true,
            task: {
              select: {
                id: true,
                name: true,
              }
            }
          }
        },
        worker: {
          select: {
            id: true,
            name: true,
          }
        },
        user: {
          select: {
            id: true,
            name: true,
          }
        }
      }
      });
      if (!response || response.length === 0) {
        return { message: 'Feeding not found', status: 404 };
      }
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }

//  async findByOperation(id_operation: number, id_site?: number) {
//   try {
//     const validation = await this.validation.validateAllIds({
//       id_operation,
//     });
//     // Si la operación no existe, retorna array vacío
//     if (validation && 'status' in validation && validation.status === 404) {
//       return [];
//     }

//     // Construir el filtro de manera dinámica
//     const whereClause: any = { id_operation };
//     if (id_site) {
//       whereClause.worker = { id_site };
//     }

//     const response = await this.prisma.workerFeeding.findMany({
//       where: whereClause,
//       include: {
//         operation: {
//           select: {
//             id: true,
//             task: {
//               select: {
//                 id: true,
//                 name: true, // nombre del servicio/tarea
//               }
//             }
//           }
//         },
//         worker: {
//           select: {
//             id: true,
//             name: true,
//           }
//         }
//       }
//     });

//     // Si no hay registros, retorna array vacío
//     if (!response || response.length === 0) {
//       return [];
//     }

//     // Filtrar registros donde la operación no fue encontrada o no tiene nombre de servicio/tarea
//     const filtered = response.filter(
//       feeding =>
//         feeding.operation &&
//         feeding.operation.task &&
//         feeding.operation.task.name
//     );

//     return filtered.map(feeding => ({
//       ...feeding,
//       serviceName: feeding.operation?.task?.name || null,
//       workerName: feeding.worker?.name || null,
//     }));
//   } catch (error) {
//     throw new Error(error.message || String(error));
//   }
// }
  async update(
    id: number,
    updateFeedingDto: UpdateFeedingDto,
    id_site?: number,
  ) {
    try {
      const validation = await this.validation.validateAllIds({
        id_operation: updateFeedingDto.id_operation,
      });
      if (validation && 'status' in validation && validation.status === 404) {
        return validation;
      }
      const validate = await this.findOne(id);

      if (validate && 'status' in validate && validate.status === 404) {
        return validate;
      }
      if (id_site !== undefined) {
        const workerValidationData = await this.validation.validateAllIds({
          workerIds: [validate['id_worker']],
        });
        const workerValidation = workerValidationData?.existingWorkers?.[0];
        if (workerValidation && workerValidation.id_site !== id_site) {
          return {
            message: 'Not authorized to update feeding for this worker',
            status: 409,
          };
        }
        const operationValidation = validation['operation'].id_site;
        if (operationValidation && operationValidation !== id_site) {
          return {
            message: 'Not authorized to update feeding for this operation',
            status: 409,
          };
        }
      }

      // **NUEVA VALIDACIÓN PARA UPDATE**: Solo validar si se está cambiando el tipo o el trabajador
      if (updateFeedingDto.type && updateFeedingDto.type !== validate['type']) {
        const today = new Date();
        const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

        const existingFeeding = await this.prisma.workerFeeding.findFirst({
          where: {
            id_worker: updateFeedingDto.id_worker || validate['id_worker'],
            type: updateFeedingDto.type,
            dateFeeding: {
              gte: startOfDay,
              lte: endOfDay,
            },
            NOT: {
              id: id, // Excluir el registro actual
            },
          },
        });

        if (existingFeeding) {
          const feedingTypeNames = {
            BREAKFAST: 'desayuno',
            LUNCH: 'almuerzo',
            DINNER: 'cena',
            SNACK: 'refrigerio',
          };

          return {
            message: `El trabajador ya tiene registrado un ${feedingTypeNames[updateFeedingDto.type]} para el día de hoy`,
            status: 409,
          };
        }
      }

      const response = await this.prisma.workerFeeding.update({
        where: {
          id,
        },
        data: {
          ...updateFeedingDto,
          id_worker: updateFeedingDto.id_worker,
          id_operation: updateFeedingDto.id_operation,
          // Actualizar dateFeeding si viene en el DTO
          ...(updateFeedingDto.dateFeeding && {
            dateFeeding: new Date(updateFeedingDto.dateFeeding),
          }),
        },
      });
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }

  async remove(id: number, id_site?: number) {
    try {
      const validate = await this.findOne(id);
      if (validate && 'status' in validate && validate.status === 404) {
        return validate;
      }
      if (id_site !== undefined) {
        const workerValidationData = await this.validation.validateAllIds({
          workerIds: [validate['id_worker']],
        });
        const workerValidation = workerValidationData?.existingWorkers?.[0];
        if (workerValidation && workerValidation.id_site !== id_site) {
          return {
            message: 'Not authorized to delete feeding for this worker',
            status: 409,
          };
        }
      }
      const response = await this.prisma.workerFeeding.delete({
        where: {
          id,
        },
      });
      return response;
    } catch (error) {
      throw new Error(error);
    }
  }

  /**
 * Retorna las alimentaciones faltantes por trabajador en una operación para el día actual
 */
async getMissingMealsForOperation(operationId: number) {
    // console.log(`🔍 [DEBUG] === INICIANDO getMissingMealsForOperation para operación ${operationId} ===`);

  // Obtener la operación y sus trabajadores
  const operation = await this.prisma.operation.findUnique({
    where: { 
      id: operationId 
    },
    include: {
       workers: { 
        include: { worker: true } 
      } 
      },
  });
  if (!operation) {
        console.log(`❌ [DEBUG] Operación ${operationId} no encontrada`);

    return [];
  }

  // ✅ NUEVA VALIDACIÓN: Solo mostrar comidas faltantes para operaciones activas
  if (operation.status !== 'INPROGRESS' && operation.status !== 'PENDING') {
    // console.log(`❌ [DEBUG] Operación ${operationId} tiene estado '${operation.status}' - no mostrar comidas faltantes`);
    return [];
  }

  // console.log(`📋 [DEBUG] Operación encontrada:`);
  // console.log(`   ------------------ ID: ${operation.id}`);
  // console.log(`   ------------ Fecha inicio: ${operation.dateStart}`);
  // console.log(`   -------------- Hora inicio: ${operation.timeStrat}`);
  // console.log(`   ------------- Estado: ${operation.status}`);
  // console.log(`   ------------- Trabajadores: ${operation.workers.length}`);

// ✅ VALIDACIÓN ADICIONAL: Si está PENDING, verificar si debería estar activa
  if (operation.status === 'PENDING') {
    const now = new Date();
    const [hours, minutes] = operation.timeStrat.split(':').map(Number);
    const operationStart = new Date(operation.dateStart);
    operationStart.setUTCHours(hours, minutes, 0, 0);
    
    const minutesDiff = Math.floor((now.getTime() - operationStart.getTime()) / (1000 * 60));
    
    // Si la operación debería haber empezado hace más de 1 minuto pero sigue PENDING
    if (minutesDiff > 1) {
      // console.log(`⚠️ [DEBUG] Operación ${operationId} debería estar INPROGRESS (${minutesDiff} min de retraso) pero está PENDING`);
      // Opcional: Actualizar automáticamente el estado aquí
      // await this.prisma.operation.update({
      //   where: { id: operationId },
      //   data: { status: 'INPROGRESS' }
      // });
    } else if (minutesDiff < 0) {
      // console.log(`⏰ [DEBUG] Operación ${operationId} aún no ha empezado (falta ${Math.abs(minutesDiff)} min)`);
      return []; // No mostrar comidas faltantes para operaciones futuras
    }
  }


  const today = new Date();
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const endOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);

  // ✅ NUEVA LÓGICA: Determinar qué comidas ya deberían haber pasado
  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinutes;

  // Obtener fecha y hora de inicio de operación
  const [hours, minutes] = operation.timeStrat.split(':').map(Number);
  
  // ✅ CORREGIR: No modificar la fecha original, crear una nueva instancia local
  const operationStart = new Date(operation.dateStart);
  // ✅ Usar setUTCHours para evitar problemas de zona horaria
  operationStart.setUTCHours(hours, minutes, 0, 0);
  
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  // ✅ CORREGIR: Usar directamente la fecha de la operación sin modificaciones
  const operationDateOnly = new Date(operation.dateStart);
  const operationStartDate = new Date(operationDateOnly.getUTCFullYear(), operationDateOnly.getUTCMonth(), operationDateOnly.getUTCDate());
  
    const isFirstDay = todayDate.getTime() === operationStartDate.getTime();
  const daysFromStart = Math.floor((todayDate.getTime() - operationStartDate.getTime()) / (24 * 60 * 60 * 1000));
 
  // Horarios de comidas (deben coincidir con getAvailableMealTypes)
  const mealSchedule = {
    BREAKFAST: { start: 6 * 60, end: 7 * 60 },     // 6:00 AM - 7:00 AM
    LUNCH: { start: 12 * 60, end: 13 * 60 },       // 12:00 PM - 1:00 PM
    DINNER: { start: 18 * 60, end: 19 * 60 },      // 6:00 PM - 7:00 PM
    SNACK: { start: 23 * 60, end: 24 * 60 },       // 11:00 PM - 12:00 AM
  };

  const mealTypes = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  let passedMeals: string[] = [];

  // ✅ Si es el mismo día que empezó la operación
  if (isFirstDay) {
    const startTotalMinutes = operationStart.getHours() * 60 + operationStart.getMinutes();
    // console.log(`🕐 [DEBUG] PRIMER DÍA - Minutos inicio operación: ${startTotalMinutes}`);
    
    for (const mealType of mealTypes) {
      const schedule = mealSchedule[mealType];
      if (schedule) {
        // ✅ CONDICIONES CORREGIDAS:
        // 1. La operación empezó ANTES del final de esa comida específica
        // 2. El tiempo actual ya pasó el final de esa comida específica  
        const operationStartedBeforeEnd = startTotalMinutes < schedule.end;
        const currentTimePassedEnd = currentTotalMinutes > schedule.end;
        
        // console.log(`🍽️ [DEBUG] ${mealType}:`);
        // console.log(`   - Horario: ${Math.floor(schedule.start/60)}:${(schedule.start%60).toString().padStart(2,'0')} - ${Math.floor(schedule.end/60)}:${(schedule.end%60).toString().padStart(2,'0')}`);
        // console.log(`   - Operación empezó antes del final (${startTotalMinutes} < ${schedule.end}): ${operationStartedBeforeEnd}`);
        // console.log(`   - Tiempo actual pasó el final (${currentTotalMinutes} > ${schedule.end}): ${currentTimePassedEnd}`);
        
        // ✅ LÓGICA CORREGIDA: Solo es faltante si:
        // 1. La operación empezó antes del final de esa comida Y
        // 2. El tiempo actual ya pasó el final de esa comida Y
        // 3. La operación tuvo acceso lógico a esa comida
        if (operationStartedBeforeEnd && currentTimePassedEnd) {
          
          let shouldHaveAccess = false;
          
          if (mealType === 'BREAKFAST') {
            // Breakfast: acceso si empezó antes de las 7:00 AM
            shouldHaveAccess = startTotalMinutes < schedule.end;
          } else if (mealType === 'LUNCH') {
            // Lunch: acceso solo si empezó antes de las 13:00 PM Y después de las 6:00 AM
            shouldHaveAccess = startTotalMinutes < schedule.end && startTotalMinutes >= (6 * 60);
          } else if (mealType === 'DINNER') {
            // Dinner: acceso solo si empezó antes de las 19:00 PM Y después de las 12:00 PM
            shouldHaveAccess = startTotalMinutes < schedule.end && startTotalMinutes >= (12 * 60);
          } else if (mealType === 'SNACK') {
            // Snack: acceso solo si empezó antes de las 24:00 Y después de las 18:00 PM
            shouldHaveAccess = startTotalMinutes < schedule.end && startTotalMinutes >= (18 * 60);
          }
          
          // console.log(`   - ¿Debería tener acceso? ${shouldHaveAccess}`);
          // console.log(`   - ¿Tiempo actual (${currentTotalMinutes}) > final comida (${schedule.end})? ${currentTimePassedEnd}`);
          
          if (shouldHaveAccess) {
            passedMeals.push(mealType);
            // console.log(`✅ [DEBUG] ${mealType} agregado como faltante (primer día)`);
          } 
        //   else {
        //     console.log(`❌ [DEBUG] ${mealType} NO tiene acceso (empezó muy temprano/tarde para esta comida)`);
        //   }
        // } else {
        //   // console.log(`❌ [DEBUG] ${mealType} NO es faltante - Razón:`);
        //   if (!operationStartedBeforeEnd) {
        //     console.log(`     - Operación empezó DESPUÉS del final de la comida (${startTotalMinutes} >= ${schedule.end})`);
        //   }
        //   if (!currentTimePassedEnd) {
        //     console.log(`     - Tiempo actual AÚN NO ha pasado el final de la comida (${currentTotalMinutes} <= ${schedule.end})`);
        //   }
        }
      }
    }
  } else if (todayDate.getTime() > operationStartDate.getTime()) {
    // console.log(`🕐 [DEBUG] DÍAS POSTERIORES (${daysFromStart} días después)`);
    
    // ✅ Para días posteriores: determinar qué comidas han pasado realmente desde el inicio de la operación hasta ahora
    
    // Primero, determinar qué comidas pasaron en el día de inicio (después de la hora de inicio)
    const startTotalMinutes = operationStart.getUTCHours() * 60 + operationStart.getUTCMinutes();
    const mealsPassedOnStartDay: string[] = [];
    
    for (const mealType of mealTypes) {
      const schedule = mealSchedule[mealType];
      if (schedule) {
        // En el día de inicio, solo considerar comidas que:
        // 1. Empezaron DESPUÉS de la hora de inicio de la operación
        // 2. O que estaban en progreso cuando empezó la operación
        const mealStartedAfterOperation = schedule.start >= startTotalMinutes;
        const mealWasInProgressWhenStarted = startTotalMinutes >= schedule.start && startTotalMinutes < schedule.end;
        
        if (mealStartedAfterOperation || mealWasInProgressWhenStarted) {
          mealsPassedOnStartDay.push(mealType);
          // console.log(`✅ [DEBUG] ${mealType} estaba disponible en el día de inicio (empezó después: ${mealStartedAfterOperation}, en progreso: ${mealWasInProgressWhenStarted})`);
        } 
        // else {
        //   console.log(`❌ [DEBUG] ${mealType} NO estaba disponible en el día de inicio (terminó antes de iniciar operación)`);
        // }
      }
    }
    
    // Segundo, determinar qué comidas ya pasaron HOY
    const mealsPassedToday: string[] = [];
    for (const mealType of mealTypes) {
      const schedule = mealSchedule[mealType];
      if (schedule) {
        const hasPassedToday = currentTotalMinutes > schedule.end;
        // console.log(`🍽️ [DEBUG] ${mealType}: actual(${currentTotalMinutes}) > fin(${schedule.end}) = ${hasPassedToday}`);
        
        if (hasPassedToday) {
          mealsPassedToday.push(mealType);
          // console.log(`✅ [DEBUG] ${mealType} ya pasó HOY`);
        }
      }
    }
    
    // Combinar: comidas del día de inicio + comidas que ya pasaron hoy
    passedMeals = [...new Set([...mealsPassedOnStartDay, ...mealsPassedToday])];
  }

  // console.log(`📋 [DEBUG] Comidas que deberían haber pasado HOY: [${passedMeals.join(', ')}]`);

  // ✅ Si no han pasado comidas aún, no hay comidas faltantes
  if (passedMeals.length === 0) {
    // console.log(`🚫 [DEBUG] No hay comidas faltantes`);
    return [];
  }

  const result: { workerId: number; workerName: string; missingMeals: string[] }[] = [];
  
  for (const opWorker of operation.workers) {
    // ✅ BUSCAR COMIDAS DESDE EL INICIO DE LA OPERACIÓN, NO SOLO HOY
    const operationStartDay = new Date(operationStartDate.getFullYear(), operationStartDate.getMonth(), operationStartDate.getDate());
    
    const feedings = await this.prisma.workerFeeding.findMany({
      where: {
        id_worker: opWorker.id_worker,
        // id_operation: operationId,
        dateFeeding: { 
          gte: operationStartDay, 
          lte: endOfDay 
        },
      },
      include: {
      operation: {
        select: {
          id: true,
          task: {
            select: {
              name: true
            }
          }
        }
      }
    }
    });
    
    const registeredMeals = feedings.map(f => `${f.type}(${f.dateFeeding.toISOString().split('T')[0]})`);
    
    let allMissing: string[] = [];
    
    if (isFirstDay) {   
      const todayMissing = passedMeals.filter(type => !feedings.some(f => {
        const feedingDate = new Date(f.dateFeeding);
        const feedingDay = new Date(feedingDate.getFullYear(), feedingDate.getMonth(), feedingDate.getDate());
        return f.type === type && feedingDay.getTime() === todayDate.getTime();
      }));
      
      allMissing = todayMissing;
      // console.log(`📊 [DEBUG] Primer día - Solo comidas faltantes de HOY: [${allMissing.join(', ')}]`);
      
    } else {
      // ✅ DÍAS POSTERIORES: Comidas faltantes de hoy + días anteriores
      // console.log(`🎯 [DEBUG] Procesando DÍAS POSTERIORES para ${opWorker.worker.name}`);
      
      // Solo las comidas faltantes de hoy
      const todayMissing = passedMeals.filter(type => !feedings.some(f => {
        const feedingDate = new Date(f.dateFeeding);
        const feedingDay = new Date(feedingDate.getFullYear(), feedingDate.getMonth(), feedingDate.getDate());
        return f.type === type && feedingDay.getTime() === todayDate.getTime();
      }));
      
      // También agregar comidas faltantes de días anteriores que nunca se registraron
      const previousDaysMissing: string[] = [];
      for (let d = 0; d < daysFromStart; d++) {
        const checkDate = new Date(operationStartDate);
        checkDate.setDate(checkDate.getDate() + d);
        const checkDay = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
        
        for (const mealType of mealTypes) {
          const hasThisMeal = feedings.some(f => {
            const feedingDate = new Date(f.dateFeeding);
            const feedingDay = new Date(feedingDate.getFullYear(), feedingDate.getMonth(), feedingDate.getDate());
            return f.type === mealType && feedingDay.getTime() === checkDay.getTime();
          });
          
          if (!hasThisMeal) {
            // Verificar si esta comida debería existir en ese día
            if (d === 0) {
              // Primer día: solo si empezó antes del final de la comida Y tuvo acceso lógico
              const startTotalMinutes = operationStart.getUTCHours() * 60 + operationStart.getUTCMinutes();
              const schedule = mealSchedule[mealType];
              
              if (schedule) {
                // La comida debería existir solo si:
                // 1. Empezó DESPUÉS de la hora de inicio de la operación, O
                // 2. Estaba en progreso cuando empezó la operación
                const mealStartedAfterOperation = schedule.start >= startTotalMinutes;
                const mealWasInProgressWhenStarted = startTotalMinutes >= schedule.start && startTotalMinutes < schedule.end;
                
                if (mealStartedAfterOperation || mealWasInProgressWhenStarted) {
                  previousDaysMissing.push(mealType);
                  // console.log(`📝 [DEBUG] Día ${d} - ${mealType} agregado como faltante (disponible desde inicio)`);
                }
                //  else {
                //   console.log(`📝 [DEBUG] Día ${d} - ${mealType} NO agregado (no estaba disponible cuando empezó operación)`);
                // }
              }
            } else {
              // Días intermedios: todas las comidas
              previousDaysMissing.push(mealType);
            }
          }
        }
      }
      
      allMissing = [...new Set([...todayMissing, ...previousDaysMissing])];
      // console.log(`📊 [DEBUG] Días posteriores - Faltantes HOY: [${todayMissing.join(', ')}]`);
      // console.log(`📊 [DEBUG] Días posteriores - Faltantes ANTERIORES: [${previousDaysMissing.join(', ')}]`);
      // console.log(`📊 [DEBUG] Días posteriores - TOTAL: [${allMissing.join(', ')}]`);
    }
    
    if (allMissing.length > 0) {
      // console.log(`🍽️ [DEBUG] Trabajador ${opWorker.worker.name} - Comidas faltantes TOTAL: [${allMissing.join(', ')}]`);
      
      result.push({
        workerId: opWorker.id_worker,
        workerName: opWorker.worker.name,
        missingMeals: allMissing,
      });
    } else {
      console.log(`✅ [DEBUG] Trabajador ${opWorker.worker.name} - Sin comidas faltantes`);
    }
  }

  
  // console.log(`📊 ------------------[DEBUG] === RESULTADO FINAL ===`);
  // console.log(`📊 ----------------[DEBUG] Operación ${operationId} - Trabajadores con comidas faltantes: ${result.length}`);
  // console.log(`📊 ----------------[DEBUG] Detalle:`);
  // result.forEach(worker => {
  //   console.log(`  -------------------- - ${worker.workerName}: [${worker.missingMeals.join(', ')}]`);
  // });
  // console.log(`📊 ----------------[DEBUG] === FIN getMissingMealsForOperation ===`);
  
  // console.log(`📊 [DEBUG] Total trabajadores con comidas faltantes: ${result.length}`);
  return result;
}
}
