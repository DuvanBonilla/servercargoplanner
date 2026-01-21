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
    
    const startTotalMinutes = operationStart.getUTCHours() * 60 + operationStart.getUTCMinutes();
    const endTotalMinutes = operationEnd ? (
      operationEnd.getUTCHours() * 60 + operationEnd.getUTCMinutes()) : (24 * 60);
    const currentTotalMinutes = now.getUTCHours() * 60 + now.getUTCMinutes();
    
    // console.log(`⏰ Horario trabajo: ${Math.floor(startTotalMinutes/60)}:${(startTotalMinutes%60).toString().padStart(2,'0')} - ${Math.floor(endTotalMinutes/60)}:${(endTotalMinutes%60).toString().padStart(2,'0')}`);
    // console.log(`⏰ Hora actual: ${Math.floor(currentTotalMinutes/60)}:${(currentTotalMinutes%60).toString().padStart(2,'0')}`);
    
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

// ✅ NORMALIZAR FECHA: Extraer string ISO y parsear solo YYYY-MM-DD
const dateStr = fullOperation.dateStart instanceof Date 
  ? fullOperation.dateStart.toISOString().split('T')[0] 
  : String(fullOperation.dateStart).split('T')[0];

const [year, month, day] = dateStr.split('-').map(Number);
const normalizedDateStart = new Date(year, month - 1, day); // month es 0-indexed

// ✅ USAR LA FECHA NORMALIZADA
const availableMealTypes = this.getAvailableMealTypes(
  normalizedDateStart, 
  fullOperation.timeStrat,
  fullOperation.timeEnd
);


      // Validar horario solo si la comida NO es una faltante anterior
      if (!availableMealTypes.includes(createFeedingDto.type)) {
        // Consultar comidas faltantes anteriores
        const missingMeals = await this.getMissingMealsForOperation(createFeedingDto.id_operation);
        const workerMissing = missingMeals.find(worker =>
          worker.workerId === createFeedingDto.id_worker &&
          worker.missingMeals.includes(createFeedingDto.type)
        );

        if (!workerMissing) {
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
        
        // ✅ SI ES UNA COMIDA FALTANTE RETRASADA, REGISTRAR TODAS LAS FALTANTES DE ESE TIPO
        console.log(`[FeedingService] 📋 Detectada comida retrasada para trabajador ${createFeedingDto.id_worker}`);
        console.log(`[FeedingService] 📋 Tipo: ${createFeedingDto.type}`);
        console.log(`[FeedingService] 📋 Comidas faltantes: ${workerMissing.missingMeals.join(', ')}`);
        
        // Contar cuántas veces aparece este tipo de comida en las faltantes
        const countMissing = workerMissing.missingMeals.filter(meal => meal === createFeedingDto.type).length;
        
        console.log(`[FeedingService] 🔢 Total de ${createFeedingDto.type} faltantes: ${countMissing}`);
        
        // ✅ OBTENER FECHAS REALES DEL GRUPO/TRABAJADOR (no de la operación general)
        const workerOperation = await this.prisma.operation_Worker.findFirst({
          where: { 
            id_operation: createFeedingDto.id_operation,
            id_worker: createFeedingDto.id_worker
          },
          select: { dateStart: true, dateEnd: true, timeStart: true }
        });
        
        if (!workerOperation || !workerOperation.dateStart) {
          return { message: 'Worker operation dates not found', status: 404 };
        }
        
        const createdFeedings: any[] = [];
        const today = new Date();
        const todayLocal = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        
        // ✅ NORMALIZAR FECHA DE INICIO DEL TRABAJADOR/GRUPO
        const dateStr = workerOperation.dateStart instanceof Date 
          ? workerOperation.dateStart.toISOString().split('T')[0] 
          : String(workerOperation.dateStart).split('T')[0];
        
        const [year, month, day] = dateStr.split('-').map(Number);
        const operationStartLocal = new Date(year, month - 1, day);
        
        console.log(`[FeedingService] 📅 Fecha inicio GRUPO: ${operationStartLocal.toISOString().split('T')[0]}`);
        
        // ✅ CALCULAR FECHA FIN DEL TRABAJADOR/GRUPO SI EXISTE
        let operationEndLocal: Date | null = null;
        let effectiveEndDate = todayLocal;
        
        if (workerOperation.dateEnd) {
          const dateEndStr = workerOperation.dateEnd instanceof Date 
            ? workerOperation.dateEnd.toISOString().split('T')[0] 
            : String(workerOperation.dateEnd).split('T')[0];
          const [endYear, endMonth, endDay] = dateEndStr.split('-').map(Number);
          operationEndLocal = new Date(endYear, endMonth - 1, endDay);
          console.log(`[FeedingService] 📅 Fecha fin GRUPO: ${operationEndLocal.toISOString().split('T')[0]}`);
          
          effectiveEndDate = operationEndLocal.getTime() < todayLocal.getTime() 
            ? operationEndLocal 
            : todayLocal;
        }
        
        console.log(`[FeedingService] 📅 Fecha efectiva: ${effectiveEndDate.toISOString().split('T')[0]}`);
        
        // ✅ CALCULAR CUÁNTOS DÍAS HAN PASADO hasta effectiveEndDate
        const daysPassed = Math.floor((effectiveEndDate.getTime() - operationStartLocal.getTime()) / (24 * 60 * 60 * 1000));
        
        console.log(`[FeedingService] 📅 Días desde inicio grupo: ${daysPassed}`);
        console.log(`[FeedingService] 📅 Fecha inicio: ${operationStartLocal.toISOString().split('T')[0]}`);
        console.log(`[FeedingService] 📅 Fecha hoy: ${todayLocal.toISOString().split('T')[0]}`);
        
        // ✅ DETERMINAR EN QUÉ DÍAS DEBERÍA HABER ESTA COMIDA
        const startHour = workerOperation.timeStart 
          ? parseInt(workerOperation.timeStart.split(':')[0]) 
          : 0;
        const mealSchedule = {
          BREAKFAST: 6,
          LUNCH: 12,
          DINNER: 18,
          SNACK: 23,
        };
        
        const mealHour = mealSchedule[createFeedingDto.type];
        const daysToRegister: Date[] = [];
        
        // ✅ VERIFICAR SI EL GRUPO YA TERMINÓ
        const groupHasEnded = operationEndLocal && operationEndLocal.getTime() < todayLocal.getTime();
        
        // ✅ DÍA 0 (día de inicio): 
        // Si el grupo ya terminó, agregar sin restricción. Si sigue activo, verificar horario
        if (groupHasEnded) {
          daysToRegister.push(new Date(operationStartLocal));
          console.log(`[FeedingService] ✅ Día inicio agregado (grupo terminado)`);
        } else if (startHour <= mealHour) {
          daysToRegister.push(new Date(operationStartLocal));
          console.log(`[FeedingService] ✅ Día inicio agregado (horario válido)`);
        }
        
        // ✅ DÍAS SIGUIENTES: Agregar cada día hasta effectiveEndDate
        for (let i = 1; i <= daysPassed; i++) {
          const dayDate = new Date(operationStartLocal);
          dayDate.setDate(dayDate.getDate() + i);
          
          // Si el grupo ya terminó, agregar todas las fechas
          if (groupHasEnded) {
            daysToRegister.push(dayDate);
          } else if (i === daysPassed) {
            // Es hoy y el grupo sigue activo, verificar hora
            const now = new Date();
            const currentHour = now.getHours();
            const mealEndHour = mealHour + 1; // La comida termina 1 hora después
            
            if (currentHour > mealEndHour) {
              daysToRegister.push(dayDate);
            }
          } else {
            // Días anteriores siempre se agregan
            daysToRegister.push(dayDate);
          }
        }
        
        console.log(`[FeedingService] 📆 Días donde debería registrarse ${createFeedingDto.type}: ${daysToRegister.length}`);
        
        // ✅ CREAR REGISTRO PARA CADA DÍA QUE NO TENGA YA UNO
        for (const feedingDate of daysToRegister) {
          const dayStart = new Date(feedingDate);
          dayStart.setHours(0, 0, 0, 0);
          const dayEnd = new Date(feedingDate);
          dayEnd.setHours(23, 59, 59, 999);
          
          // Verificar que no exista ya un registro para ese día
          const existingForDay = await this.prisma.workerFeeding.findFirst({
            where: {
              id_worker: createFeedingDto.id_worker,
              type: createFeedingDto.type,
              dateFeeding: {
                gte: dayStart,
                lte: dayEnd,
              },
            },
          });
          
          if (!existingForDay) {
            const feeding = await this.prisma.workerFeeding.create({
              data: {
                id_worker: createFeedingDto.id_worker,
                id_operation: createFeedingDto.id_operation,
                id_user: createFeedingDto.id_user,
                type: createFeedingDto.type,
                dateFeeding: feedingDate,
              },
            });
            
            createdFeedings.push(feeding);
            console.log(`[FeedingService] ✅ Registrado ${createFeedingDto.type} para fecha: ${feedingDate.toISOString().split('T')[0]}`);
          } else {
            console.log(`[FeedingService] ⚠️ Ya existe ${createFeedingDto.type} para fecha: ${feedingDate.toISOString().split('T')[0]}`);
          }
        }
        
        console.log(`[FeedingService] 📊 Total de alimentaciones retrasadas registradas: ${createdFeedings.length}`);
        
        if (createdFeedings.length > 0) {
          return {
            message: `Se registraron ${createdFeedings.length} alimentaciones retrasadas`,
            count: createdFeedings.length,
            feedings: createdFeedings,
          };
        }
        
        // Si no se creó ninguna (todas ya existían), continuar con flujo normal
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

      // ✅ NORMALIZAR FECHA: Extraer string ISO y parsear solo YYYY-MM-DD
      const dateStr = operation.dateStart instanceof Date 
        ? operation.dateStart.toISOString().split('T')[0] 
        : String(operation.dateStart).split('T')[0];
      
      const [year, month, day] = dateStr.split('-').map(Number);
      const normalizedDateStart = new Date(year, month - 1, day); // month es 0-indexed

       // ✅ OBTENER COMIDAS DISPONIBLES POR HORARIO
    const availableMealTypes = this.getAvailableMealTypes(
      normalizedDateStart, 
      operation.timeStrat, 
      operation.timeEnd
    );

        // ✅ AGREGAR COMIDAS FALTANTES COMO DISPONIBLES PARA REGISTRO
    const missingMeals = await this.getMissingMealsForOperation(operationId);
    const allMissingMealTypes = [...new Set(missingMeals.flatMap(worker => worker.missingMeals))];
    
    // ✅ COMBINAR: comidas de horario + comidas faltantes
    const allAvailableMeals = [...new Set([...availableMealTypes, ...allMissingMealTypes])];
    
    // console.log(`🍽️ [DEBUG] Op ${operationId}:`);
    // console.log(`   - Por horario: [${availableMealTypes.join(', ')}]`);
    // console.log(`   - Faltantes: [${allMissingMealTypes.join(', ')}]`);
    // console.log(`   - Total disponibles: [${allAvailableMeals.join(', ')}]`);
      
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
      return []; // Retornar array vacío en lugar de 404
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
        // console.log(`[FeedingService] ⚠️ No se encontraron registros de alimentación para los filtros aplicados`);
        // if (filters?.id_site) {
        //   console.log(`[FeedingService] ⚠️ Filtro id_site=${filters.id_site} - Verificar que existan registros para este sitio`);
        // }
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
        ...(id_site && {
          worker: {
            id_site,
          },
        }),
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
    return response.map(feeding => ({
      ...feeding,
      serviceName: feeding.operation?.task?.name || null,
      workerName: feeding.worker?.name || null,
      userName: feeding.user?.name || null,
    }));
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

  const now = new Date();
  const currentHour = now.getHours();
  const currentMinutes = now.getMinutes();
  const currentTotalMinutes = currentHour * 60 + currentMinutes;
  const todayDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
 
  // Horarios de comidas (deben coincidir con getAvailableMealTypes)
  const mealSchedule = {
    BREAKFAST: { start: 6 * 60, end: 7 * 60 },
    LUNCH: { start: 12 * 60, end: 13 * 60 },
    DINNER: { start: 18 * 60, end: 19 * 60 },
    SNACK: { start: 23 * 60, end: 24 * 60 },
  };

  const mealTypes = ['BREAKFAST', 'LUNCH', 'DINNER', 'SNACK'];
  const result: { workerId: number; workerName: string; missingMeals: string[] }[] = [];
  
  for (const opWorker of operation.workers) {
    // ✅ OBTENER FECHAS ESPECÍFICAS DEL TRABAJADOR
    const workerStartDate = opWorker.dateStart || operation.dateStart;
    const workerEndDate = opWorker.dateEnd;
    
    // ✅ NORMALIZAR FECHAS DEL TRABAJADOR
    const workerStartStr = workerStartDate instanceof Date 
      ? workerStartDate.toISOString().split('T')[0] 
      : String(workerStartDate).split('T')[0];
    const [wYear, wMonth, wDay] = workerStartStr.split('-').map(Number);
    const workerStartLocal = new Date(wYear, wMonth - 1, wDay);
    
    // ✅ FECHA EFECTIVA DE FIN (mínimo entre dateEnd del trabajador y hoy)
    let workerEffectiveEnd = todayDate;
    if (workerEndDate) {
      const workerEndStr = workerEndDate instanceof Date 
        ? workerEndDate.toISOString().split('T')[0] 
        : String(workerEndDate).split('T')[0];
      const [weYear, weMonth, weDay] = workerEndStr.split('-').map(Number);
      const workerEndLocal = new Date(weYear, weMonth - 1, weDay);
      
      if (workerEndLocal < todayDate) {
        // Si el trabajador ya terminó, no tiene comidas faltantes
        continue;
      }
      workerEffectiveEnd = workerEndLocal;
    }
    
    // ✅ CALCULAR COMIDAS QUE DEBERÍAN HABER PASADO PARA ESTE TRABAJADOR
    const workerIsFirstDay = todayDate.getTime() === workerStartLocal.getTime();
    const workerDaysFromStart = Math.floor((todayDate.getTime() - workerStartLocal.getTime()) / (24 * 60 * 60 * 1000));
    
    // console.log(`🔍 [DEBUG] ${opWorker.worker.name}:`);
    // console.log(`   workerStartLocal: ${workerStartLocal.toISOString()}`);
    // console.log(`   todayDate: ${todayDate.toISOString()}`);
    // console.log(`   workerIsFirstDay: ${workerIsFirstDay}`);
    // console.log(`   workerDaysFromStart: ${workerDaysFromStart}`);
    
    // Obtener hora de inicio del trabajador
    const [wHours, wMinutes] = (opWorker.timeStart || operation.timeStrat).split(':').map(Number);
    const workerStartTime = new Date(workerStartLocal);
    workerStartTime.setHours(wHours, wMinutes, 0, 0);
    const workerStartTotalMinutes = wHours * 60 + wMinutes;
    
    // console.log(`   Hora inicio: ${wHours}:${wMinutes} (${workerStartTotalMinutes} min)`);
    // console.log(`   Hora actual: ${currentHour}:${currentMinutes} (${currentTotalMinutes} min)`);
    
    let workerPassedMeals: string[] = [];
    
    if (workerIsFirstDay) {
      // ✅ PRIMER DÍA: Solo comidas que pasaron después de la hora de inicio
      for (const mealType of mealTypes) {
        const schedule = mealSchedule[mealType];
        if (schedule) {
          const operationStartedBeforeEnd = workerStartTotalMinutes < schedule.end;
          const currentTimePassedEnd = currentTotalMinutes > schedule.end;
          
          if (operationStartedBeforeEnd && currentTimePassedEnd) {
            let shouldHaveAccess = false;
            
            if (mealType === 'BREAKFAST') {
              shouldHaveAccess = workerStartTotalMinutes < schedule.end;
            } else if (mealType === 'LUNCH') {
              shouldHaveAccess = workerStartTotalMinutes < schedule.end && workerStartTotalMinutes >= (6 * 60);
            } else if (mealType === 'DINNER') {
              shouldHaveAccess = workerStartTotalMinutes < schedule.end && workerStartTotalMinutes >= (12 * 60);
            } else if (mealType === 'SNACK') {
              shouldHaveAccess = workerStartTotalMinutes < schedule.end && workerStartTotalMinutes >= (18 * 60);
            }
            
            if (shouldHaveAccess) {
              workerPassedMeals.push(mealType);
            }
          }
        }
      }
    } else if (todayDate.getTime() > workerStartLocal.getTime()) {
      // ✅ DÍAS POSTERIORES: Solo comidas que YA PASARON HOY
      // console.log(`🎯 [DEBUG] ${opWorker.worker.name} - DÍAS POSTERIORES`);
      // console.log(`   Fecha inicio trabajador: ${workerStartLocal.toISOString().split('T')[0]}`);
      // console.log(`   Fecha hoy: ${todayDate.toISOString().split('T')[0]}`);
      // console.log(`   Hora actual: ${currentHour}:${currentMinutes} (${currentTotalMinutes} minutos)`);
      
      // Comidas que ya pasaron HOY (solo las que terminaron)
      for (const mealType of mealTypes) {
        const schedule = mealSchedule[mealType];
        if (schedule) {
          const hasPassedToday = currentTotalMinutes > schedule.end;
          // console.log(`   ${mealType}: fin=${schedule.end} min, actual=${currentTotalMinutes} min, pasó? ${hasPassedToday}`);
          
          if (hasPassedToday) {
            workerPassedMeals.push(mealType);
          }
        }
      }
      
      // console.log(`   Comidas que YA PASARON hoy: [${workerPassedMeals.join(', ')}]`);
    }
    
    // ✅ Si no han pasado comidas para este trabajador, continuar con el siguiente
    if (workerPassedMeals.length === 0) {
      continue;
    }
    
    // ✅ BUSCAR COMIDAS REGISTRADAS DEL TRABAJADOR
    const workerStartDay = new Date(workerStartLocal.getFullYear(), workerStartLocal.getMonth(), workerStartLocal.getDate());
    
    const feedings = await this.prisma.workerFeeding.findMany({
      where: {
        id_worker: opWorker.id_worker,
        dateFeeding: { 
          gte: workerStartDay, 
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
    
    // ✅ CALCULAR COMIDAS FALTANTES
    let allMissing: string[] = [];
    
    if (workerIsFirstDay) {   
      const todayMissing = workerPassedMeals.filter(type => !feedings.some(f => {
        const feedingDate = new Date(f.dateFeeding);
        const feedingDay = new Date(feedingDate.getFullYear(), feedingDate.getMonth(), feedingDate.getDate());
        return f.type === type && feedingDay.getTime() === todayDate.getTime();
      }));
      
      allMissing = todayMissing;
    } else {
      // Solo las comidas faltantes de hoy
      const todayMissing = workerPassedMeals.filter(type => !feedings.some(f => {
        const feedingDate = new Date(f.dateFeeding);
        const feedingDay = new Date(feedingDate.getFullYear(), feedingDate.getMonth(), feedingDate.getDate());
        return f.type === type && feedingDay.getTime() === todayDate.getTime();
      }));
      
      // Comidas faltantes de días anteriores
      const previousDaysMissing: string[] = [];
      for (let d = 0; d < workerDaysFromStart; d++) {
        const checkDate = new Date(workerStartLocal);
        checkDate.setDate(checkDate.getDate() + d);
        const checkDay = new Date(checkDate.getFullYear(), checkDate.getMonth(), checkDate.getDate());
        
        for (const mealType of mealTypes) {
          const hasThisMeal = feedings.some(f => {
            const feedingDate = new Date(f.dateFeeding);
            const feedingDay = new Date(feedingDate.getFullYear(), feedingDate.getMonth(), feedingDate.getDate());
            return f.type === mealType && feedingDay.getTime() === checkDay.getTime();
          });
          
          if (!hasThisMeal) {
            if (d === 0) {
              // Primer día: solo comidas disponibles desde el inicio
              const schedule = mealSchedule[mealType];
              if (schedule) {
                const mealStartedAfterOperation = schedule.start >= workerStartTotalMinutes;
                const mealWasInProgressWhenStarted = workerStartTotalMinutes >= schedule.start && workerStartTotalMinutes < schedule.end;
                
                if (mealStartedAfterOperation || mealWasInProgressWhenStarted) {
                  previousDaysMissing.push(mealType);
                }
              }
            } else {
              // Días intermedios: todas las comidas
              previousDaysMissing.push(mealType);
            }
          }
        }
      }
      
       allMissing = [...todayMissing, ...previousDaysMissing];
      // console.log(`📊 [DEBUG] ${opWorker.worker.name} - Faltantes HOY: [${todayMissing.join(', ')}]`);
      // console.log(`📊 [DEBUG] ${opWorker.worker.name} - Faltantes ANTERIORES: [${previousDaysMissing.join(', ')}]`);
    }
    
    if (allMissing.length > 0) {
      result.push({
        workerId: opWorker.id_worker,
        workerName: opWorker.worker.name,
        missingMeals: allMissing,
      });
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
