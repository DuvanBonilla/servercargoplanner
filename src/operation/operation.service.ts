import { BadRequestException, ConflictException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { CreateOperationDto } from './dto/create-operation.dto';
import { UpdateOperationDto } from './dto/update-operation.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { OperationWorkerService } from 'src/operation-worker/operation-worker.service';
// import { BillService } from 'src/bill/bill.service';
import { StatusComplete, StatusOperation } from '@prisma/client';
import { OperationFinderService } from './services/operation-finder.service';
import { OperationRelationService } from './services/operation-relation.service';
import { OperationFilterDto } from './dto/fliter-operation.dto';
import { WorkerService } from 'src/worker/worker.service';
import { RemoveWorkerFromOperationService } from '../operation-worker/service/remove-worker-from-operation/remove-worker-from-operation.service';
import { ModuleRef } from '@nestjs/core';
import { getWeekNumber } from 'src/common/utils/dateType';
// ... otras importaciones
/**
 * Servicio para gestionar operaciones
 * @class OperationService
 */
@Injectable()
export class OperationService {
  constructor(
    private prisma: PrismaService,
    private operationWorkerService: OperationWorkerService,
    private finderService: OperationFinderService,
    private relationService: OperationRelationService,
    private workerService: WorkerService,
    private removeWorkerService: RemoveWorkerFromOperationService,
    private moduleRef: ModuleRef,
    // private billService: BillService,
  ) {}
  /**
   * Obtiene todas las operaciones
   * @returns Lista de operaciones con relaciones incluidas
   */
  async findAll(id_site?: number, id_subsite?: number) {
    return await this.finderService.findAll(id_site, id_subsite);
  }
  /**
   * Busca una operación por su ID
   * @param id - ID de la operación a buscar
   * @returns Operación encontrada o mensaje de error
   */
  async findOne(id: number, id_site?: number, id_subsite?: number) {
    return await this.finderService.findOne(id, id_site, id_subsite);
  }
  /**
   * Obtiene una operación con detalles de tarifas
   * @param operationId - ID de la operación a buscar
   * @returns Operación con detalles de tarifas o mensaje de error
   */
  async getOperationWithDetailedTariffs(operationId: number) {
    return await this.finderService.getOperationWithDetailedTariffs(
      operationId,
    );
  }
  /**
   * Encuentra todas las operaciones activas (IN_PROGRESS y PENDING) sin filtros de fecha
   * @returns Lista de operaciones activas o mensaje de error
   */
  async findActiveOperations(
    statuses: StatusOperation[],
    id_site?: number,
    id_subsite?: number,
  ) {
    return await this.finderService.findByStatuses(
      statuses,
      id_site,
      id_subsite,
    );
  }
  /**
   *  Busca operaciones por rango de fechas
   * @param start Fecha de inicio
   * @param end Fecha de fin
   * @returns resultado de la busqueda
   */
  async findOperationRangeDate(
    start: Date,
    end: Date,
    id_site?: number,
    id_subsite?: number,
  ) {
    return await this.finderService.findByDateRange(
      start,
      end,
      id_site,
      id_subsite,
    );
  }
  /**
   * Encuentra operaciones asociadas a un usuario específico
   * @param id_user ID del usuario para buscar operaciones
   * @returns  Lista de operaciones asociadas al usuario o mensaje de error
   */
  async findOperationByUser(
    id_user: number,
    id_site?: number,
    id_subsite?: number,
  ) {
    return await this.finderService.findByUser(id_user, id_site, id_subsite);
  }
  /**
   * Obtener operaciones con paginación y filtros opcionales
   */
  async findAllPaginated(
    page: number = 1,
    limit: number = 10,
    filters?: OperationFilterDto,
    activatePaginated: boolean = true,
  ) {
    return this.finderService.findAllPaginated(
      page,
      limit,
      filters,
      activatePaginated,
    );
  }
  /**
   * Crea una nueva operación y asigna trabajadores
   * @param createOperationDto - Datos de la operación a crear
   * @returns Operación creada
   */
  async createWithWorkers(
    createOperationDto: CreateOperationDto,
    id_subsite?: number,
    id_site?: number,
  ) {
    try {
      console.log('[OperationService] ==> INICIANDO createWithWorkers');
      console.log('[OperationService] createOperationDto:', JSON.stringify(createOperationDto, null, 2));

      if (createOperationDto.id_subsite) {
        id_subsite = createOperationDto.id_subsite;
      }

      console.log('[OperationService] ==> Buscando usuario:', createOperationDto.id_user);
      // Obtener el usuario y su rol (ajusta según tu modelo)
      const user = await this.prisma.user.findUnique({
        where: { id: createOperationDto.id_user },
        select: { role: true },
      });
      console.log('[OperationService] ==> Usuario encontrado:', user);

      // Validar fecha para SUPERVISOR
      if (user?.role === 'SUPERVISOR' && createOperationDto.dateStart) {
        console.log('[OperationService] ==> Validando fecha para SUPERVISOR');
        // Si el usuario existe y su rol es 'SUPERVISOR', y además se proporcionó dateStart en el DTO
        const now = new Date(); // Obtener la fecha/hora actual
        const dateStart = new Date(createOperationDto.dateStart); // Convertir la fecha proporcionada a un objeto Date
        const diffMs = now.getTime() - dateStart.getTime(); // Calcular la diferencia en milisegundos entre ahora y dateStart
        const diffHours = diffMs / (1000 * 60 * 60); // Convertir la diferencia de ms a horas: $diffHours = \\frac{diffMs}{1000\\times60\\times60}$
        
        if (diffHours >= 120) {
          console.log('[OperationService] ==> Error: SUPERVISOR intenta crear operación muy antigua');
          // Si la diferencia es mayor o igual a 120 horas (5 días), devolver un objeto con mensaje y estado 400
          return {
            message:
              'Como SUPERVISOR solo puedes crear operaciones con máximo o igual a 120 horas de antigüedad.',
            status: 400,
          };
        }
      }

      console.log('[OperationService] ==> Validando user ID');
      // Validaciones
      if (createOperationDto.id_user === undefined) {
        console.log('[OperationService] ==> Error: User ID requerido');
        return { message: 'User ID is required', status: 400 };
      }

      console.log('[OperationService] ==> Extrayendo trabajadores e IDs');
      // Extraer y validar IDs de trabajadores
      const { workerIds = [], groups = [] } = createOperationDto;
      console.log('[OperationService] ==> workerIds:', workerIds);
      console.log('[OperationService] ==> groups:', JSON.stringify(groups, null, 2));
      
      const scheduledWorkerIds =
        this.relationService.extractScheduledWorkerIds(groups);
      const allWorkerIds = [...workerIds, ...scheduledWorkerIds];
      console.log('[OperationService] ==> scheduledWorkerIds:', scheduledWorkerIds);
      console.log('[OperationService] ==> allWorkerIds:', allWorkerIds);

      console.log('[OperationService] ==> Validando worker IDs');
      const validateWorkerIds = await this.relationService.validateWorkerIds(
        allWorkerIds,
        id_subsite,
        id_site,
      );
      console.log('[OperationService] ==> validateWorkerIds resultado:', validateWorkerIds);
      if (validateWorkerIds?.status === 403) {
        return validateWorkerIds;
      }

      console.log('[OperationService] ==> Validando programación cliente');
      //validar programacion cliente
      const validateClientProgramming =
        await this.relationService.validateClientProgramming(
          createOperationDto.id_clientProgramming || null,
        );
      console.log('[OperationService] ==> validateClientProgramming resultado:', validateClientProgramming);

      if (validateClientProgramming) return validateClientProgramming;

      console.log('[OperationService] ==> Validando todos los IDs');
      // Validar todos los IDs
      const validationResult = await this.relationService.validateOperationIds(
        {
          id_area: createOperationDto.id_area,
          id_task: createOperationDto.id_task,
          id_client: createOperationDto.id_client,
          workerIds: allWorkerIds,
          inChargedIds: createOperationDto.inChargedIds,
        },
        groups,
        id_site,
      );
      console.log('[OperationService] ==> validationResult:', validationResult);

      if (
        validationResult &&
        validationResult.status &&
        validationResult.status !== 200
      ) {
        console.log('[OperationService] ==> Error en validación, retornando:', validationResult);
        return validationResult;
      }

      console.log('[OperationService] ==> Creando operación');
      // Crear la operación
      const operation = await this.createOperation(
        createOperationDto,
        id_subsite,
      );
      console.log('[OperationService] ==> Operación creada:', operation);

      // VERIFICAR SI HAY ERROR ANTES DE ACCEDER A 'id'
      if ('status' in operation && 'message' in operation) {
        console.log('[OperationService] ==> Error en creación de operación:', operation);
        return operation;
      }

      console.log('[OperationService] ==> Asignando trabajadores y encargados');
      // Asignar trabajadores y encargados
      const response = await this.relationService.assignWorkersAndInCharge(
        operation.id,
        workerIds,
        groups,
        createOperationDto.inChargedIds || [],
        id_subsite,
        id_site,
      );
      console.log('[OperationService] ==> Resultado asignación:', response);
      
      if (response && (response.status === 403 || response.status === 400)) {
        console.log('[OperationService] ==> Error en asignación:', response);
        return response;
      }
      
      console.log('[OperationService] ==> SUCCESS: Operación creada con ID:', operation.id);
      return { id: operation.id };
    } catch (error) {
      console.error('[OperationService] ==> ERROR en createWithWorkers:', error);
      console.error('[OperationService] ==> Stack trace:', error.stack);
      throw new Error(error.message);
    }
  }

  private calculateOperationDuration(
    dateStart: Date,
    timeStrat: string,
    dateEnd: Date,
    timeEnd: string,
  ): number {
    if (!dateStart || !timeStrat || !dateEnd || !timeEnd) return 0;

    const start = new Date(dateStart);
    const [sh, sm] = timeStrat.split(':').map(Number);
    start.setHours(sh, sm, 0, 0);

    const end = new Date(dateEnd);
    const [eh, em] = timeEnd.split(':').map(Number);
    end.setHours(eh, em, 0, 0);

    const diffMs = end.getTime() - start.getTime();
    const durationHours = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100; // 2 decimales
    return durationHours > 0 ? durationHours : 0;
  }

  /**
   * Crea un registro de operación
   * @param operationData - Datos de la operación
   * @returns Operación creada
   */
  private async createOperation(
    operationData: CreateOperationDto,
    id_subsite?: number,
  ) {
    const {
      workerIds,
      groups,
      inChargedIds,
      dateStart,
      dateEnd,
      timeStrat,
      timeEnd,
      id_clientProgramming,
      id_task,
      ...restOperationData
    } = operationData;

    // Si id_task no viene en operationData, pero sí en el primer grupo, úsalo
    const mainTaskId =
      id_task ||
      (groups && groups.length > 0 && groups[0].id_task
        ? groups[0].id_task
        : null);

    if (id_subsite !== undefined) {
      if (operationData.id_subsite !== id_subsite) {
        return { message: 'Subsite does not match', status: 400 };
      }
    }

    // ✅ CALCULAR op_duration SI SE PROPORCIONA FECHA Y HORA COMPLETAS
    let calculatedOpDuration = 0;
    if (dateStart && timeStrat && dateEnd && timeEnd) {
      const start = new Date(dateStart);
      const [sh, sm] = timeStrat.split(':').map(Number);
      start.setHours(sh, sm, 0, 0);

      const end = new Date(dateEnd);
      const [eh, em] = timeEnd.split(':').map(Number);
      end.setHours(eh, em, 0, 0);

      const diffMs = end.getTime() - start.getTime();
      calculatedOpDuration = Math.round((diffMs / (1000 * 60 * 60)) * 100) / 100;
      calculatedOpDuration = calculatedOpDuration > 0 ? calculatedOpDuration : 0;
      
      console.log(`[OperationService] ✅ op_duration calculado al crear: ${calculatedOpDuration} horas`);
    }

    const newOperation = await this.prisma.operation.create({
      data: {
        ...restOperationData,
        id_user: operationData.id_user as number,
        id_clientProgramming: id_clientProgramming || null,
        id_task: mainTaskId,
        dateStart: dateStart,
        dateEnd: dateEnd ? new Date(dateEnd) : null,
        timeStrat: timeStrat,
        timeEnd: timeEnd || null,
        id_subsite: id_subsite || null,
        op_duration: calculatedOpDuration,
      },
    });

    // 🔔 DESPERTAR SISTEMA: Si se crea una operación, despertar el cron job del sueño profundo
    try {
      const { UpdateOperationService } = await import('../cron-job/services/update-operation.service');
      const updateOperationService = this.moduleRef.get(UpdateOperationService, { strict: false });
      updateOperationService.wakeUpFromDeepSleep(`Nueva operación creada (ID: ${newOperation.id})`);
      
      // // 🚀 PROCESAMIENTO INMEDIATO: También despertar el cron service para verificación inmediata
      // try {
      //   const { OperationsCronService } = await import('../cron-job/cron-job.service');
      //   const cronService = this.moduleRef.get(OperationsCronService, { strict: false });
      //   await cronService.wakeUpAndProcess(`Nueva operación creada desde Flutter/App (ID: ${newOperation.id})`);
      // } catch (cronError) {
      //   console.warn('[OperationService] ⚠️ Wake up exitoso, pero procesamiento inmediato falló:', cronError.message);
      // }
    } catch (error) {
      // No lanzar error si falla el wake up, solo loggear
      console.warn('[OperationService] ⚠️ No se pudo despertar el sistema automático:', error.message);
    }

    if (id_clientProgramming) {
      await this.prisma.clientProgramming.update({
        where: { id: id_clientProgramming },
        data: {
          status: StatusComplete.ASSIGNED,
        },
      });
    }
    return newOperation;
  }
  /**
   * Actualiza una operación existente
   * @param id - ID de la operación a actualizar
   * @param updateOperationDto - Datos de actualización
   * @returns Operación actualizada
   */
  async update(
  id: number,
  updateOperationDto: UpdateOperationDto,
  id_subsite?: number,
  id_site?: number,
) {
  try {
    console.log('[OperationService] Iniciando actualización de operación:', id);
    console.log('[OperationService] DTO recibido:', JSON.stringify(updateOperationDto, null, 2));

    // Verify operation exists
    const validate = await this.findOne(id);
    if (validate['status'] === 404) {
      return validate;
    }

    // Validate inCharged IDs
    const validationResult =
      await this.relationService.validateInChargedIds(updateOperationDto);
    if (validationResult) return validationResult;

    // Extract data for update
    const {
      workers,
      inCharged,
      groups,
      dateStart,
      dateEnd,
      timeStrat,
      timeEnd,
      
      ...directFields
    } = updateOperationDto;

    // ✅ VERIFICAR SI LA OPERACIÓN ESTÁ COMPLETADA ANTES DE PROCESAR TRABAJADORES
    const currentOperation = await this.prisma.operation.findUnique({
      where: { id },
      select: { status: true },
    });

    const isCompletedOperation = currentOperation?.status === 'COMPLETED';

    // Process workers
    // if (workers) {
    //   console.log('[OperationService] Procesando workers con nuevo flujo V2');
    //   await this.processWorkersOperationsV2(id, workers);
    // }

    //Process workers

    // Process workers
    if (workers) {
      // console.log('[OperationService] Procesando workers con nuevo flujo V2');
      
      // ✅ SI ES OPERACIÓN COMPLETADA Y HAY CAMBIOS EN TRABAJADORES, RECALCULAR FACTURA
      if (isCompletedOperation) {
        // console.log('[OperationService] 🔄 Operación COMPLETED detectada, procesando cambios en trabajadores...');
        await this.processWorkersOperationsV2(id, workers, true); // ✅ Pasar flag isCompleted
        
        // Buscar y recalcular factura
        try {
          const bill = await this.prisma.bill.findFirst({
            where: { id_operation: id },
          });

          if (bill) {
            console.log(`[OperationService] 📄 Factura encontrada (ID: ${bill.id}), recalculando por cambios en trabajadores...`);
            
            // Importar dinámicamente BillService para evitar dependencia circular
            const { BillService } = await import('../bill/bill.service');
            const billService = this.moduleRef.get(BillService, { strict: false });
            
            // Recalcular la factura por cambios en trabajadores
            await billService.recalculateBillAfterOpDurationChange(bill.id, id);
            
            // console.log(`[OperationService] ✅ Factura ${bill.id} recalculada por cambios en trabajadores`);
          } 
          // else {
          //   console.log('[OperationService] ⚠️ No se encontró factura para esta operación completada');
          // }
        } catch (error) {
          console.error('[OperationService] ❌ Error recalculando factura por cambios en trabajadores:', error.message);
          // No lanzar error para no bloquear la actualización de la operación
        }
      } else {
        // Operación no completada, proceso normal
        await this.processWorkersOperationsV2(id, workers);
      }
    }


    // ✅ PROCESAR GRUPOS (FINALIZACIÓN DE GRUPOS)
    if (groups && Array.isArray(groups) && groups.length > 0) {
      // console.log('[OperationService] Procesando finalización de grupos:', groups);
      await this.processGroupsCompletion(id, groups);
    }

    // Process inCharged
    if (inCharged) {
      console.log('[OperationService] Procesando inCharged directamente');
      await this.processInChargedOperations(id, inCharged);
    }

    // ✅ PASAR TODOS LOS PARÁMETROS DE FECHA/HORA AL MÉTODO
    const operationUpdateData = this.prepareOperationUpdateData(
      directFields,
      dateStart,
      dateEnd,
      timeStrat,
      timeEnd, // ✅ ASEGURAR QUE SE PASE timeEnd
    );

    // Update operation
    if (Object.keys(operationUpdateData).length > 0) {
      console.log('[OperationService] Actualizando datos básicos de la operación');
      console.log('[OperationService] Datos a actualizar:', operationUpdateData);
      
      await this.prisma.operation.update({
        where: { id },
        data: operationUpdateData,
      });
    }
    // ✅ RECALCULAR op_duration siempre que haya cambios en fechas u horas
const hasDateTimeChanges = dateStart || dateEnd || timeStrat || timeEnd;
    
  
    if (hasDateTimeChanges) {
      console.log('[OperationService] 🔄 Detectados cambios en fechas/horas, recalculando op_duration...');
      
      // Obtener la operación actualizada con todas las fechas
      const updatedOp = await this.prisma.operation.findUnique({
        where: { id },
        select: { dateStart: true, timeStrat: true, dateEnd: true, timeEnd: true, status: true, op_duration: true },
      });

      console.log('[OperationService] 📊 Operación leída de BD:');
      console.log('   - dateStart:', updatedOp?.dateStart);
      console.log('   - timeStrat:', updatedOp?.timeStrat);
      console.log('   - dateEnd:', updatedOp?.dateEnd);
      console.log('   - timeEnd:', updatedOp?.timeEnd);
      console.log('   - op_duration actual:', updatedOp?.op_duration);
      console.log('   - status:', updatedOp?.status);

      if (updatedOp && updatedOp.dateStart && updatedOp.timeStrat && updatedOp.dateEnd && updatedOp.timeEnd) {
        const oldOpDuration = updatedOp.op_duration;
        const newOpDuration = this.calculateOperationDuration(
          updatedOp.dateStart,
          updatedOp.timeStrat,
          updatedOp.dateEnd,
          updatedOp.timeEnd,
        );

        console.log(`[OperationService] 📐 Cálculo de duración:`);
        console.log(`   - Duración anterior: ${oldOpDuration} horas`);
        console.log(`   - Duración nueva: ${newOpDuration} horas`);
        console.log(`   - ¿Cambió?: ${oldOpDuration !== newOpDuration}`);

        await this.prisma.operation.update({
          where: { id },
          data: { op_duration: newOpDuration },
        });

        console.log(`[OperationService] ✅ op_duration actualizado en BD: ${oldOpDuration} → ${newOpDuration} horas (status: ${updatedOp.status})`);

        // ✅ SI LA OPERACIÓN ESTÁ COMPLETED Y CAMBIÓ op_duration, RECALCULAR FACTURA
        if (updatedOp.status === 'COMPLETED' && oldOpDuration !== newOpDuration) {
          // console.log('[OperationService] 🔄 Operación COMPLETED con cambio de duración, buscando factura...');
          
          try {
            // Buscar la factura de esta operación
            const bill = await this.prisma.bill.findFirst({
              where: { id_operation: id },
            });

            if (bill) {
              // console.log(`[OperationService] 📄 Factura encontrada (ID: ${bill.id}), recalculando compensatorio...`);
              
              // Importar dinámicamente BillService para evitar dependencia circular
              const { BillService } = await import('../bill/bill.service');
              const billService = this.moduleRef.get(BillService, { strict: false });
              
              // Recalcular la factura completa
              await billService.recalculateBillAfterOpDurationChange(bill.id, id);
              
              // console.log(`[OperationService] ✅ Factura ${bill.id} recalculada con nuevo compensatorio`);
            } 
            // else {
            //   console.log('[OperationService] ⚠️ No se encontró factura para esta operación');
            // }
          } catch (error) {
            console.error('[OperationService] ❌ Error recalculando factura:', error.message);
            // No lanzar error para no bloquear la actualización de la operación
          }
        }
      } 
      // else {
      //   console.log('[OperationService] ⚠️ No se puede calcular op_duration:');
      //   console.log('   - Operación existe:', !!updatedOp);
      //   console.log('   - dateStart existe:', !!updatedOp?.dateStart);
      //   console.log('   - timeStrat existe:', !!updatedOp?.timeStrat);
      //   console.log('   - dateEnd existe:', !!updatedOp?.dateEnd);
      //   console.log('   - timeEnd existe:', !!updatedOp?.timeEnd);
      // }
    } 
    // else {
    //   console.log('[OperationService] ℹ️ No se detectaron cambios en fechas/horas, no se recalcula op_duration');
    // }

    // Handle status change
    if (directFields.status === StatusOperation.COMPLETED) {
      // Ya no necesitamos calcular op_duration aquí porque se calcula arriba cuando hay cambios de fecha
      // O ya está calculado desde antes
      
      // ✅ CAMBIAR EL ORDEN: PRIMERO ACTUALIZAR FECHAS, LUEGO CALCULAR HORAS
      await this.operationWorkerService.completeClientProgramming(id);
      await this.operationWorkerService.releaseAllWorkersFromOperation(id);
      await this.workerService.addWorkedHoursOnOperationEnd(id);
    }
    // Get updated operation
    const updatedOperation = await this.findOne(id);
    console.log('[OperationService] Operación actualizada exitosamente');
    return updatedOperation;
  } catch (error) {
    console.error('Error updating operation:', error);
    throw new Error(error.message);
  }

  
}

  /**
   * Prepara los datos para actualizar una operación
   * @param directFields - Campos directos a actualizar
   * @param dateStart - Fecha de inicio
   * @param dateEnd - Fecha de fin
   * @param timeStrat - Hora de inicio
   * @param timeEnd - Hora de fin
   * @param observation - Observación del trabajo
   * @returns Objeto con datos preparados para actualizar
   */
  private prepareOperationUpdateData(
    directFields: any,
    dateStart?: string,
    dateEnd?: string,
    timeStrat?: string,
    timeEnd?: string,
    observation?: string,
  ) {
    const updateData = { ...directFields };

    // Eliminar campos que NO pertenecen a la tabla Operation
    delete updateData.workers;      // Este es del DTO, no de la tabla
    delete updateData.inCharged;    // Este es del DTO, no de la tabla
    delete updateData.workerIds;    // Este es del DTO, no de la tabla
    delete updateData.inChargedIds; // Este es del DTO, no de la tabla
    delete updateData.groups;       // Este es del DTO, no de la tabla
    delete updateData.removedWorkerIds; // Este es del DTO, no de la tabla
    delete updateData.originalWorkerIds; // Este es del DTO, no de la tabla
    delete updateData.updatedGroups; // Este es del DTO, no de la tabla
    delete updateData.id_tariff;    //  NO EXISTE EN Operation - viene de worker/grupo
    delete updateData.id_subtask;   //  NO EXISTE EN Operation - viene de worker/grupo
    delete updateData.id_task_worker; //  NO EXISTE EN Operation - viene de worker/grupo

    // MANTENER solo los campos que SÍ existen en la tabla Operation según el schema:
    // - status, zone, motorShip, dateStart, dateEnd, timeStrat, timeEnd
    // - createAt, updateAt, op_duration
    // - id_area, id_client, id_clientProgramming, id_user, id_task, id_site, id_subsite

    console.log('[OperationService] Campos después de limpieza:', Object.keys(updateData));

    if (observation) updateData.observation = observation;
  // ✅ PROCESAR FECHAS Y HORAS RESPETANDO LO QUE ENVÍA EL USUARIO
  if (dateStart) updateData.dateStart = new Date(dateStart);
  
  // ✅ MANEJAR FECHA DE FIN
  if (dateEnd) {
    updateData.dateEnd = new Date(dateEnd);
  } else if (updateData.status === StatusOperation.COMPLETED && !dateEnd) {
    // Solo establecer fecha actual si el usuario NO envió dateEnd
    updateData.dateEnd = new Date();
  }
  
  // ✅ MANEJAR HORA DE INICIO
  if (timeStrat) updateData.timeStrat = timeStrat;
  
  // ✅ MANEJAR HORA DE FIN - RESPETAR LA HORA DEL USUARIO
  if (timeEnd) {
    // ✅ SI EL USUARIO ENVÍA timeEnd, USARLA SIEMPRE
    updateData.timeEnd = timeEnd;
    // console.log(`[OperationService] Usando hora de fin enviada por el usuario: ${timeEnd}`);
  } else if (updateData.status === StatusOperation.COMPLETED) {
    // ✅ SOLO SI NO VIENE timeEnd Y SE ESTÁ COMPLETANDO, USAR HORA ACTUAL
    const now = new Date();
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    updateData.timeEnd = `${hh}:${mm}`;
    console.log(`[OperationService] No se recibió timeEnd, usando hora actual: ${updateData.timeEnd}`);
  }

    console.log('[OperationService] Datos finales para actualizar Operation:', updateData);
    return updateData;
  }
  /**
   * Elimina un grupo específico de una operación
   * @param id - ID de la operación
   * @param id_group - ID del grupo a eliminar
   * @param userId - ID del usuario que realiza la eliminación
   * @returns Resultado de la eliminación
   */
  async removeGroup(
    id: number,
    id_group: string,
    id_site?: number,
    id_subsite?: number,
    userId?: number,
  ) {
    try {
      // Validar que la operación existe
      const validateOperation = await this.findOne(id);
      if (validateOperation['status'] === 404) {
        return validateOperation;
      }

      if (id_site !== undefined) {
        if (validateOperation.id_site !== id_site) {
          return { message: 'Site does not match', status: 400 };
        }
      }

      if (id_subsite !== undefined) {
        if (validateOperation.id_subsite !== id_subsite) {
          return { message: 'Subsite does not match', status: 400 };
        }
      }

      // ✅ VALIDAR QUE LA FACTURA DEL GRUPO NO ESTÉ COMPLETED
      const billInGroup = await this.prisma.bill.findFirst({
        where: {
          id_operation: id,
          id_group: id_group,
        },
        select: {
          id: true,
          status: true,
          week_number: true,
          id_group: true,
        },
      });

      if (billInGroup && billInGroup.status === 'COMPLETED') {
        console.log(
          `[OperationService] ❌ Intento de eliminar grupo con factura COMPLETED`,
        );
        return {
          message: `No se puede eliminar el grupo porque la factura asociada (ID: ${billInGroup.id}) tiene estado COMPLETED. Las facturas completadas no pueden ser modificadas.`,
          status: 403,
        };
      }

      // ✅ VALIDAR SEMANA PARA SUPERVISOR
      if (userId) {
        const user = await this.prisma.user.findUnique({
          where: { id: userId },
          select: { role: true },
        });

        if (user?.role === 'SUPERVISOR' && billInGroup?.status === 'ACTIVE') {
          // Obtener semana actual
          const currentDate = new Date();
          const currentWeekNumber = getWeekNumber(currentDate);

         

          if (billInGroup.week_number !== currentWeekNumber) {
            console.log(
              `[OperationService] ❌ SUPERVISOR intenta eliminar grupo de semana diferente`,
            );
            return {
              message: `No tiene permitido eliminar este grupo porque pertenece a la semana ${billInGroup.week_number} y la semana actual es ${currentWeekNumber}. Los supervisores solo pueden eliminar grupos de la semana actual.`,
              status: 403,
            };
          }
        }
      }

      // Usar transacción para eliminar el grupo y sus dependencias
      return await this.prisma.$transaction(async (tx) => {
        // 1. Obtener los trabajadores del grupo primero
        const workersInGroup = await tx.operation_Worker.findMany({
          where: {
            id_operation: id,
            id_group: id_group,
          },
          select: { id: true, id_worker: true },
        });

        const workerIds = workersInGroup.map((w) => w.id_worker);
        const operationWorkerIds = workersInGroup.map((w) => w.id);

        console.log(
          `[OperationService] Grupo tiene ${workerIds.length} trabajadores: ${workerIds.join(', ')}`,
        );
        console.log(
          `[OperationService] Operation_Worker IDs: ${operationWorkerIds.join(', ')}`,
        );

        // 2. PRIMERO: Eliminar TODOS los BillDetails que referencian a los Operation_Worker del grupo
        if (operationWorkerIds.length > 0) {
          console.log(
            // `[OperationService] Eliminando TODOS los BillDetails que referencian a los ${operationWorkerIds.length} Operation_Worker del grupo`,
          );
          
          const deletedAllBillDetails = await tx.billDetail.deleteMany({
            where: { 
              id_operation_worker: { in: operationWorkerIds }
            },
          });
          
          console.log(
            `[OperationService] ✅ Eliminados ${deletedAllBillDetails.count} BillDetails que referenciaban a los Operation_Worker`,
          );
        }

        // 3. Si hay factura del grupo y quedó vacía (sin BillDetails), eliminarla
        if (billInGroup && billInGroup.status === 'ACTIVE') {
          // Verificar si la factura tiene BillDetails restantes
          const remainingBillDetails = await tx.billDetail.count({
            where: { id_bill: billInGroup.id },
          });

          if (remainingBillDetails === 0) {
            // console.log(
            //   `[OperationService] Eliminando factura ${billInGroup.id} del grupo ${id_group} (sin BillDetails restantes)`,
            // );
            await tx.bill.delete({
              where: { id: billInGroup.id },
            });
            // console.log(
            //   `[OperationService] ✅ Factura ${billInGroup.id} eliminada`,
            // );
          } else {

            // console.log(
            //   `[OperationService] ℹ️ Factura ${billInGroup.id} conservada (tiene ${remainingBillDetails} BillDetails de otros grupos)`,
            // );
          }
        }

        // 4. Eliminar WorkerFeeding asociados a esta operación y trabajadores del grupo
        if (workerIds.length > 0) {
          console.log(
            `[OperationService] Eliminando WorkerFeeding de ${workerIds.length} trabajadores`,
          );
          await tx.workerFeeding.deleteMany({
            where: {
              id_operation: id,
              id_worker: { in: workerIds },
            },
          });
        }

        // 5. Eliminar Operation_Workers del grupo - SIEMPRE (basado en id_group)
        console.log(
          `[OperationService] Eliminando ${operationWorkerIds.length} registros de Operation_Worker del grupo ${id_group}`,
        );
        
        const deletedWorkers = await tx.operation_Worker.deleteMany({
          where: {
            id_operation: id,
            id_group: id_group,
          },
        });
        
        console.log(
          `[OperationService] ✅ Eliminados ${deletedWorkers.count} Operation_Worker del grupo ${id_group}`,
        );

        // 5. Liberar trabajadores si ya no están en otras operaciones
        for (const workerId of workerIds) {
          const remainingAssignments = await tx.operation_Worker.count({
            where: { id_worker: workerId },
          });

          if (remainingAssignments === 0) {
            console.log(
              `[OperationService] Liberando trabajador ${workerId} (sin más asignaciones)`,
            );
            await tx.worker.update({
              where: { id: workerId },
              data: { status: 'AVALIABLE' },
            });
          }
        }

        console.log(
          `[OperationService] ✅ Grupo ${id_group} eliminado exitosamente de operación ${id}`,
        );

        return {
          message: `Grupo eliminado exitosamente`,
          deletedWorkers: deletedWorkers.count,
          id_group: id_group,
        };
      });
    } catch (error) {
      console.error('[OperationService] Error eliminando grupo:', error);
      throw new Error(error.message);
    }
  }

  /**
   * Elimina una operación por su ID o un grupo específico
   * @param id - ID de la operación a eliminar
   * @param id_group - ID del grupo a eliminar (opcional)
   * @param userId - ID del usuario que realiza la eliminación
   * @returns Operación eliminada o información de grupos disponibles
   */
  async remove(
    id: number,
    id_site?: number,
    id_subsite?: number,
    id_group?: string,
    userId?: number,
  ) {
    try {
      const validateOperation = await this.findOne(id);
      if (validateOperation['status'] === 404) {
        return validateOperation;
      }

      if (id_site !== undefined) {
        if (validateOperation.id_site !== id_site) {
          return { message: 'Site does not match', status: 400 };
        }
      }

      if (id_subsite !== undefined) {
        if (validateOperation.id_subsite !== id_subsite) {
          return { message: 'Subsite does not match', status: 400 };
        }
      }

      // ✅ SI SE PROPORCIONA id_group, ELIMINAR SOLO ESE GRUPO
      if (id_group) {
        return await this.removeGroup(id, id_group, id_site, id_subsite, userId);
      }

      // ✅ SI NO SE PROPORCIONA id_group, VERIFICAR CUÁNTOS GRUPOS HAY
      const groups = await this.prisma.operation_Worker.findMany({
        where: { id_operation: id },
        select: { id_group: true },
        distinct: ['id_group'],
      });

      const uniqueGroups = groups
        .map((g) => g.id_group)
        .filter((groupId): groupId is string => Boolean(groupId));

      if (uniqueGroups.length === 0) {
        // No hay grupos, eliminar la operación completa
        return await this.removeOperationCompletely(id, id_site, id_subsite);
      } else if (uniqueGroups.length === 1) {
        // Solo hay un grupo, eliminarlo y luego eliminar la operación
        console.log(
          `[OperationService] Solo hay un grupo (${uniqueGroups[0]}), eliminando grupo y operación completa`,
        );
        
        // Eliminar el grupo primero
        const groupResult = await this.removeGroup(
          id,
          uniqueGroups[0],
          id_site,
          id_subsite,
          userId,
        );
        
        // Si hubo error al eliminar el grupo, retornar el error
        if (groupResult['status'] === 403 || groupResult['status'] === 400 || groupResult['status'] === 404) {
          return groupResult;
        }
        
        console.log(`[OperationService] Grupo eliminado, ahora eliminando operación ${id} completa`);
        
        // Eliminar la operación completa usando transacción
        try {
          await this.prisma.$transaction(async (tx) => {
            // 1. Verificar que no queden grupos
            const remainingGroups = await tx.operation_Worker.count({
              where: { id_operation: id },
            });
            
            if (remainingGroups > 0) {
              console.log(`[OperationService] ⚠️ Aún quedan ${remainingGroups} trabajadores, no se elimina la operación`);
              return;
            }
            
            // 2. Buscar y eliminar facturas
            const bills = await tx.bill.findMany({
              where: { id_operation: id },
              select: { id: true },
            });

            if (bills.length > 0) {
              const billIds = bills.map(bill => bill.id);
              
              console.log(`[OperationService] Eliminando ${bills.length} factura(s) de operación ${id}`);
              
              await tx.billDetail.deleteMany({
                where: { id_bill: { in: billIds } },
              });

              await tx.bill.deleteMany({
                where: { id_operation: id },
              });
            }

            // 3. Eliminar WorkerFeeding
            await tx.workerFeeding.deleteMany({
              where: { id_operation: id },
            });

            // 4. Eliminar InChargeOperation
            try {
              await tx.inChargeOperation.deleteMany({
                where: { id_operation: id },
              });
            } catch (error) {
              // Si la tabla no existe, continuar
            }

            // 5. Eliminar la operación
            await tx.operation.delete({
              where: { id },
            });
            
            console.log(`[OperationService] ✅ Operación ${id} eliminada exitosamente`);
          });
          
          return {
            message: `Grupo y operación eliminados exitosamente`,
            deletedWorkers: groupResult['deletedWorkers'] || 0,
            id_group: uniqueGroups[0],
            operationDeleted: true,
          };
        } catch (error) {
          console.error(`[OperationService] Error eliminando operación ${id}:`, error);
          // Si falla la eliminación de la operación, al menos el grupo se eliminó
          return {
            ...groupResult,
            warning: 'El grupo se eliminó pero hubo un error al eliminar la operación completa',
            error: error.message,
          };
        }
      } else {
        // Hay múltiples grupos, obtener información de cada uno
        const groupsInfo = await Promise.all(
          uniqueGroups.map(async (groupId) => {
            const bill = await this.prisma.bill.findFirst({
              where: {
                id_operation: id,
                id_group: groupId,
              },
              select: {
                id: true,
                status: true,
                observation: true,
              },
            });

            const workersCount = await this.prisma.operation_Worker.count({
              where: {
                id_operation: id,
                id_group: groupId,
              },
            });

            return {
              id_group: groupId,
              workersCount: workersCount,
              bill: bill
                ? {
                    id: bill.id,
                    status: bill.status,
                    observation: bill.observation,
                    canDelete: bill.status === 'ACTIVE',
                  }
                : null,
              canDelete: !bill || bill.status === 'ACTIVE',
            };
          }),
        );

        return {
          message:
            'La operación tiene múltiples grupos. Especifique el id_group que desea eliminar.',
          status: 400,
          groups: groupsInfo,
          hint: 'Use el parámetro id_group en la query para especificar el grupo a eliminar. Solo se pueden eliminar grupos con facturas en estado ACTIVE o sin factura.',
        };
      }
    } catch (error) {
      throw new Error(error.message);
    }
  }

  /**
   * Elimina múltiples grupos de una operación
   * @param id - ID de la operación
   * @param id_groups - Array de IDs de grupos a eliminar
   * @param id_site - ID del sitio
   * @param id_subsite - ID del sub-sitio
   * @param userId - ID del usuario que realiza la eliminación
   * @returns Resultado de la eliminación múltiple
   */
  async removeMultipleGroups(
    id: number,
    id_groups: string[],
    id_site?: number,
    id_subsite?: number,
    userId?: number,
  ) {
    try {
      console.log(`[OperationService] Iniciando eliminación múltiple de ${id_groups.length} grupos`);
      
      // Validar que la operación existe
      const validateOperation = await this.findOne(id);
      if (validateOperation['status'] === 404) {
        return validateOperation;
      }

      if (id_site !== undefined) {
        if (validateOperation.id_site !== id_site) {
          return { message: 'Site does not match', status: 400 };
        }
      }

      if (id_subsite !== undefined) {
        if (validateOperation.id_subsite !== id_subsite) {
          return { message: 'Subsite does not match', status: 400 };
        }
      }

      const results = {
        success: [] as Array<{
          id_group: string;
          deletedWorkers: number;
        }>,
        failed: [] as Array<{
          id_group: string;
          reason: string;
          status: number;
        }>,
        totalRequested: id_groups.length,
      };

      // Procesar cada grupo
      for (const id_group of id_groups) {
        // console.log(`[OperationService] Procesando grupo: ${id_group}`);
        
        try {
          const result = await this.removeGroup(
            id,
            id_group,
            id_site,
            id_subsite,
            userId,
          );

          // Verificar si la eliminación fue exitosa
          if (result['status'] === 403 || result['status'] === 400 || result['status'] === 404) {
            results.failed.push({
              id_group,
              reason: result['message'],
              status: result['status'],
            });
          } else {
            results.success.push({
              id_group,
              deletedWorkers: result['deletedWorkers'] || 0,
            });
          }
        } catch (error) {
          console.error(`[OperationService] Error eliminando grupo ${id_group}:`, error);
          results.failed.push({
            id_group,
            reason: error.message,
            status: 500,
          });
        }
      }

      console.log(`[OperationService] Eliminación múltiple completada: ${results.success.length} exitosos, ${results.failed.length} fallidos`);

      // ✅ VERIFICAR SI LA OPERACIÓN QUEDÓ SIN GRUPOS Y ELIMINARLA
      let operationDeleted = false;
      if (results.success.length > 0) {
        console.log(`[OperationService] Verificando si la operación ${id} quedó sin grupos...`);
        
        const remainingGroups = await this.prisma.operation_Worker.count({
          where: { id_operation: id },
        });

        console.log(`[OperationService] Grupos restantes en operación ${id}: ${remainingGroups}`);

        if (remainingGroups === 0) {
          console.log(`[OperationService] No quedan grupos, eliminando operación ${id} completa`);
          
          try {
            await this.prisma.$transaction(async (tx) => {
              // 1. Buscar y eliminar facturas
              const bills = await tx.bill.findMany({
                where: { id_operation: id },
                select: { id: true },
              });

              if (bills.length > 0) {
                const billIds = bills.map(bill => bill.id);
                
                console.log(`[OperationService] Eliminando ${bills.length} factura(s) de operación ${id}`);
                
                await tx.billDetail.deleteMany({
                  where: { id_bill: { in: billIds } },
                });

                await tx.bill.deleteMany({
                  where: { id_operation: id },
                });
              }

              // 2. Eliminar WorkerFeeding
              await tx.workerFeeding.deleteMany({
                where: { id_operation: id },
              });

              // 3. Eliminar InChargeOperation
              try {
                await tx.inChargeOperation.deleteMany({
                  where: { id_operation: id },
                });
              } catch (error) {
                // Si la tabla no existe, continuar
              }

              // 4. Eliminar la operación
              await tx.operation.delete({
                where: { id },
              });
              
              console.log(`[OperationService] ✅ Operación ${id} eliminada exitosamente`);
            });
            
            operationDeleted = true;
          } catch (error) {
            console.error(`[OperationService] Error eliminando operación ${id}:`, error);
            // No lanzar error, solo informar que los grupos se eliminaron pero la operación no
          }
        }
      }

      // Determinar el código de estado apropiado
      if (results.failed.length === 0) {
        // Todos los grupos se eliminaron exitosamente
        return {
          message: operationDeleted 
            ? `Se eliminaron exitosamente ${results.success.length} grupo(s) y la operación completa`
            : `Se eliminaron exitosamente ${results.success.length} grupo(s)`,
          status: 200,
          results,
          operationDeleted,
        };
      } else if (results.success.length === 0) {
        // Ningún grupo se eliminó
        return {
          message: 'No se pudo eliminar ningún grupo',
          status: 400,
          results,
          operationDeleted: false,
        };
      } else {
        // Algunos grupos se eliminaron, otros no (Multi-Status)
        return {
          message: operationDeleted
            ? `Se eliminaron ${results.success.length} grupo(s) y la operación completa, pero ${results.failed.length} grupos fallaron`
            : `Se eliminaron ${results.success.length} grupo(s), pero ${results.failed.length} fallaron`,
          status: 207,
          results,
          operationDeleted,
        };
      }
    } catch (error) {
      console.error('[OperationService] ❌ Error crítico en eliminación múltiple:', error);
      return {
        message: `Error crítico en eliminación múltiple: ${error.message}`,
        status: 500,
        error: error.message,
      };
    }
  }

  /**
   * Elimina completamente una operación (método auxiliar)
   * @param id - ID de la operación a eliminar
   * @returns Operación eliminada
   */
  private async removeOperationCompletely(
    id: number,
    id_site?: number,
    id_subsite?: number,
  ) {
    try {
      const validateOperation = await this.findOne(id);
      if (validateOperation['status'] === 404) {
        return validateOperation;
      }

      if (id_site !== undefined) {
        if (validateOperation.id_site !== id_site) {
          return { message: 'Site does not match', status: 400 };
        }
      }

      if (id_subsite !== undefined) {
        if (validateOperation.id_subsite !== id_subsite) {
          return { message: 'Subsite does not match', status: 400 };
        }
      }

      // Usar transacción para eliminar la operación y sus dependencias
      return await this.prisma.$transaction(async (tx) => {
        // 1. Buscar facturas asociadas a esta operación
        const bills = await tx.bill.findMany({
          where: { id_operation: id },
          select: { id: true },
        });

        // 2. Si hay facturas, eliminar primero los detalles de las facturas
        if (bills.length > 0) {
          const billIds = bills.map(bill => bill.id);
          
          console.log(`[OperationService] Eliminando detalles de ${bills.length} factura(s) asociadas a operación ${id}`);
          
          await tx.billDetail.deleteMany({
            where: { 
              id_bill: { in: billIds }
            },
          });

          // 3. Eliminar las facturas
          console.log(`[OperationService] Eliminando ${bills.length} factura(s) de operación ${id}`);
          
          await tx.bill.deleteMany({
            where: { id_operation: id },
          });
        }

        // 4. Eliminar registros de WorkerFeeding asociados a esta operación
        console.log(`[OperationService] Eliminando registros de alimentación de operación ${id}`);
        await tx.workerFeeding.deleteMany({
          where: { id_operation: id },
        });

       

        // 6. Eliminar todos los trabajadores asignados a la operación
        await tx.operation_Worker.deleteMany({
          where: { id_operation: id },
        });

        // 7. Eliminar encargados si existen
        try {
          await tx.inChargeOperation.deleteMany({
            where: { id_operation: id },
          });
        } catch (error) {
          // Si la tabla no existe, continuar
        }

        // 8. Eliminar la operación
        const response = await tx.operation.delete({
          where: { id },
        });

        console.log(`[OperationService] ✅ Operación ${id} eliminada exitosamente`);

        return response;
      });
    } catch (error) {
      throw new Error(error.message);
    }
  }

  /**
   * Elimina completamente una operación cancelada (para uso del cron)
   * @param id - ID de la operación a eliminar
   */
  async removeCompletely(id: number) {
    return await this.prisma.$transaction(async (tx) => {
      // 1. Eliminar Operation_Worker
      await tx.operation_Worker.deleteMany({
        where: { id_operation: id },
      });

      // 2. Eliminar InCharged
      try {
        await tx.inChargeOperation.deleteMany({
          where: { id_operation: id },
        });
      } catch (error) {
        // Continuar si la tabla no existe
      }

      // 3. Eliminar la operación
      return await tx.operation.delete({
        where: { id },
      });
    });
  }

  private async processWorkersOperationsV2(operationId: number, workersOps: any, isCompleted: boolean = false) {
  console.log('[OperationService] Procesando operaciones de trabajadores V2:', JSON.stringify(workersOps, null, 2));

  if (isCompleted) {
    // console.log('[OperationService] 🔄 Procesando cambios en operación COMPLETADA');
  }
  // 1. DESCONECTAR/ELIMINAR TRABAJADORES (mantener igual)
  if (workersOps.disconnect && Array.isArray(workersOps.disconnect) && workersOps.disconnect.length > 0) {
    // console.log('[OperationService] Eliminando trabajadores:', workersOps.disconnect);
    
    for (const disconnectOp of workersOps.disconnect) {
      // console.log('[OperationService] Procesando eliminación individual:', disconnectOp);
      
      if (!disconnectOp.id || isNaN(Number(disconnectOp.id))) {
        console.error('[OperationService] ID de trabajador inválido:', disconnectOp.id);
        throw new BadRequestException(`ID de trabajador inválido: ${disconnectOp.id}`);
      }
      
      const workerId = Number(disconnectOp.id);
      // console.log('[OperationService] ID de trabajador convertido a número:', workerId);
      
      try {
        if (disconnectOp.id_group) {
          // console.log('[OperationService] Eliminando trabajador del grupo específico');
          const removeResult = await this.removeWorkerService.removeWorkerFromGroup(
            operationId,
            workerId,
            disconnectOp.id_group
          );
          console.log('[OperationService] Trabajador eliminado del grupo:', removeResult);
        } else {
          console.log('[OperationService] Eliminando trabajador de toda la operación');
          const removeResult = await this.removeWorkerService.removeWorkerFromOperation(
            operationId,
            workerId
          );
          console.log('[OperationService] Trabajador eliminado de la operación:', removeResult);
        }
      } catch (error) {
        console.error('[OperationService] Error eliminando trabajador:', error);
        throw error;
      }
    }
  }

  // 2. CONECTAR/AGREGAR NUEVOS TRABAJADORES - ✅ CORREGIR AQUÍ
  // if (workersOps.connect && workersOps.connect.length > 0) {
  //   console.log('[OperationService] Agregando trabajadores:', workersOps.connect);
    
  //   for (const connectOp of workersOps.connect) {
  //     console.log('[OperationService] Procesando conexión:', connectOp);
      
  //     // ✅ VERIFICAR QUE workerIds EXISTE Y ES UN ARRAY
  //     if (!connectOp.workerIds || !Array.isArray(connectOp.workerIds)) {
  //       console.error('[OperationService] workerIds no encontrado o no es array:', connectOp);
  //       throw new BadRequestException('workerIds debe ser un array válido en la operación connect');
  //     }

  //     // ✅ PROCESAR CADA WORKER ID EN EL ARRAY
  //     // for (const workerId of connectOp.workerIds) {
  //     //   // ✅ VALIDAR QUE EL ID SEA VÁLIDO
  //     //   if (!workerId || isNaN(Number(workerId))) {
  //     //     console.error('[OperationService] ID de trabajador inválido:', workerId);
  //     //     throw new BadRequestException(`ID de trabajador inválido: ${workerId}`);
  //     //   }

  //     //   console.log(`[OperationService] Procesando trabajador ID: ${workerId}`);

  //     //   try {
  //     //     // ✅ CREAR EL OBJETO PARA ASIGNAR TRABAJADOR
  //     //     const assignData = {
  //     //       id_operation: operationId,
  //     //       id_worker: Number(workerId),
  //     //       dateStart: connectOp.dateStart || null,
  //     //       dateEnd: connectOp.dateEnd || null,
  //     //       timeStart: connectOp.timeStart || null,
  //     //       timeEnd: connectOp.timeEnd || null,
  //     //       id_task: connectOp.id_task || null,
  //     //       id_subtask: connectOp.id_subtask || null,
  //     //       id_tariff: connectOp.id_tariff || null,
  //     //     };

  //     //     console.log(`[OperationService] Datos para asignar trabajador ${workerId}:`, assignData);

  //     //     // ✅ USAR EL SERVICIO DE ASIGNACIÓN EXISTENTE
  //     //     const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
  //     //     console.log(`[OperationService] Trabajador ${workerId} asignado exitosamente:`, assignResult);
  //     //   } catch (error) {
  //     //     console.error(`[OperationService] Error asignando trabajador ${workerId}:`, error);
  //     //     throw new BadRequestException(`Error asignando trabajador ${workerId}: ${error.message}`);
  //     //   }
  //     // }
  //      try {
  //       // ✅ VERIFICAR SI ES UN NUEVO GRUPO O ASIGNACIÓN SIMPLE
  //       if (connectOp.isNewGroup) {
  //         console.log('[OperationService] Creando NUEVO GRUPO para trabajadores:', connectOp.workerIds);
          
  //         // ✅ USAR EL FORMATO CORRECTO PARA GRUPOS CON PROGRAMACIÓN
  //         const assignData = {
  //           id_operation: operationId,
  //           workersWithSchedule: [{
  //             workerIds: connectOp.workerIds.map(id => Number(id)),
  //             dateStart: connectOp.dateStart || null,
  //             dateEnd: connectOp.dateEnd || null,
  //             timeStart: connectOp.timeStart || null,
  //             timeEnd: connectOp.timeEnd || null,
  //             id_task: connectOp.id_task || null,
  //             id_subtask: connectOp.id_subtask || null,
  //             id_tariff: connectOp.id_tariff || null,
  //             // ✅ NO incluir id_group para que se genere uno nuevo automáticamente
  //           }]
  //         };

  //         console.log('[OperationService] Datos para crear nuevo grupo:', assignData);
  //         const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
  //         console.log('[OperationService] Nuevo grupo creado exitosamente:', assignResult);
          
  //       } else {
  //         console.log('[OperationService] Asignando trabajadores SIN grupo específico:', connectOp.workerIds);
          
  //         // ✅ ASIGNACIÓN SIMPLE (SIN GRUPO) - PROCESAR CADA TRABAJADOR INDIVIDUALMENTE
  //         for (const workerId of connectOp.workerIds) {
  //           // ✅ VALIDAR QUE EL ID SEA VÁLIDO
  //           if (!workerId || isNaN(Number(workerId))) {
  //             console.error('[OperationService] ID de trabajador inválido:', workerId);
  //             throw new BadRequestException(`ID de trabajador inválido: ${workerId}`);
  //           }

  //           console.log(`[OperationService] Procesando trabajador ID: ${workerId}`);

  //           // ✅ CREAR EL OBJETO PARA ASIGNAR TRABAJADOR SIMPLE
  //           const assignData = {
  //             id_operation: operationId,
  //             workerIds: [Number(workerId)], // ✅ Usar array de IDs para asignación simple
  //           };

  //           console.log(`[OperationService] Datos para asignar trabajador ${workerId}:`, assignData);
  //           const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
  //           console.log(`[OperationService] Trabajador ${workerId} asignado exitosamente:`, assignResult);
  //         }
  //       }
  //     } catch (error) {
  //       console.error(`[OperationService] Error procesando conexión:`, error);
  //       throw new BadRequestException(`Error procesando conexión: ${error.message}`);
  //     }
  //   }
  // }
//------------------------------------- FUNCIONando CORRECTAMENTE DESDE AQUÍ -----------------------------
  // // 2. CONECTAR/AGREGAR NUEVOS TRABAJADORES - ✅ CORREGIR AQUÍ
  // if (workersOps.connect && workersOps.connect.length > 0) { 
  //   console.log('[OperationService] Agregando trabajadores:', workersOps.connect);
    
  //   for (const connectOp of workersOps.connect) {
  //     console.log('[OperationService] Procesando conexión:', connectOp);
      
  //     // ✅ VERIFICAR QUE workerIds EXISTE Y ES UN ARRAY
  //     if (!connectOp.workerIds || !Array.isArray(connectOp.workerIds)) {
  //       console.error('[OperationService] workerIds no encontrado o no es array:', connectOp);
  //       throw new BadRequestException('workerIds debe ser un array válido en la operación connect');
  //     }

  //     try {
  //       // ✅ VERIFICAR SI ES UN NUEVO GRUPO O ASIGNACIÓN SIMPLE
  //       if (connectOp.isNewGroup) {
  //         console.log('[OperationService] Creando NUEVO GRUPO para trabajadores:', connectOp.workerIds);
          
  //         // ✅ USAR EL FORMATO CORRECTO PARA GRUPOS CON PROGRAMACIÓN
  //         const assignData = {
  //           id_operation: operationId,
  //           workersWithSchedule: [{
  //             workerIds: connectOp.workerIds.map(id => Number(id)),
  //             dateStart: connectOp.dateStart,
  //             dateEnd: connectOp.dateEnd || null,
  //             timeStart: connectOp.timeStart,
  //             timeEnd: connectOp.timeEnd || null,
  //             id_task: connectOp.id_task,
  //             id_subtask: connectOp.id_subtask,
  //             id_tariff: connectOp.id_tariff,
  //           }]
  //         };

  //         console.log('[OperationService] Datos para crear nuevo grupo:', assignData);
  //         const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
  //         console.log('[OperationService] Nuevo grupo creado exitosamente:', assignResult);
          
  //       } else {
  //         console.log('[OperationService] Asignando trabajadores SIN grupo específico:', connectOp.workerIds);
          
  //         // ✅ ASIGNACIÓN SIMPLE (SIN GRUPO) - PROCESAR CADA TRABAJADOR INDIVIDUALMENTE
  //         for (const workerId of connectOp.workerIds) {
  //           // ✅ VALIDAR QUE EL ID SEA VÁLIDO
  //           if (!workerId || isNaN(Number(workerId))) {
  //             console.error('[OperationService] ID de trabajador inválido:', workerId);
  //             throw new BadRequestException(`ID de trabajador inválido: ${workerId}`);
  //           }

  //           console.log(`[OperationService] Procesando trabajador ID: ${workerId}`);

  //           // ✅ CREAR EL OBJETO PARA ASIGNAR TRABAJADOR SIMPLE
  //           const assignData = {
  //             id_operation: operationId,
  //             workerIds: [Number(workerId)], // ✅ Usar array de IDs para asignación simple
  //           };

  //           console.log(`[OperationService] Datos para asignar trabajador ${workerId}:`, assignData);
  //           const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
  //           console.log(`[OperationService] Trabajador ${workerId} asignado exitosamente:`, assignResult);
  //         }
  //       }
  //     } catch (error) {
  //       console.error(`[OperationService] Error procesando conexión:`, error);
  //       throw new BadRequestException(`Error procesando conexión: ${error.message}`);
  //     }
  //   }
  // }

   // 2. CONECTAR/AGREGAR NUEVOS TRABAJADORES
  if (workersOps.connect && workersOps.connect.length > 0) { 
    console.log('[OperationService] Agregando trabajadores:', workersOps.connect);
    
    for (const connectOp of workersOps.connect) {
      console.log('[OperationService] Procesando conexión:', connectOp);
      
      // ✅ VERIFICAR QUE workerIds EXISTE Y ES UN ARRAY
      if (!connectOp.workerIds || !Array.isArray(connectOp.workerIds)) {
        console.error('[OperationService] workerIds no encontrado o no es array:', connectOp);
        throw new BadRequestException('workerIds debe ser un array válido en la operación connect');
      }

      // ✅ DETECTAR SI ES UN groupId TEMPORAL (MÓVIL)
      const isTemporaryGroupId = connectOp.groupId && connectOp.groupId.startsWith('temp_');
      const isNewGroup = connectOp.isNewGroup === true;
      const isRealExistingGroup = connectOp.groupId && !isTemporaryGroupId && !isNewGroup;
      
  

      try {
        if (isTemporaryGroupId && isNewGroup) {
          // ✅ CASO MÓVIL: DELEGAR A assignWorkersToOperation
          console.log('[OperationService] 📱 MÓVIL: Delegando creación de nuevo grupo a assignWorkersToOperation');
          
          const assignData = {
            id_operation: operationId,
            workersWithSchedule: [{
              workerIds: connectOp.workerIds.map(id => Number(id)),
              dateStart: connectOp.dateStart,
              dateEnd: connectOp.dateEnd || null,
              timeStart: connectOp.timeStart,
              timeEnd: connectOp.timeEnd || null,
              id_task: connectOp.id_task,
              id_subtask: connectOp.id_subtask,
              id_tariff: connectOp.id_tariff,
              observation: connectOp.observation, // ✅ AGREGAR OBSERVATION
              // ✅ NO incluir id_group - Se genera automáticamente
            }]
          };

          console.log('[OperationService] Datos para nuevo grupo (móvil):', assignData);
          const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
          console.log('[OperationService] Nuevo grupo creado desde móvil:', assignResult);

        } else if (isRealExistingGroup) {
          // ✅ CASO: AGREGAR A GRUPO EXISTENTE REAL
          console.log('[OperationService] 🔗 Agregando a grupo existente real:', connectOp.groupId);
          
          // ✅ OBTENER VALORES DEL GRUPO EXISTENTE PARA HEREDARLOS
          const existingGroupWorker = await this.prisma.operation_Worker.findFirst({
            where: {
              id_operation: operationId,
              id_group: connectOp.groupId,
            },
            include: {
              tariff: true,
            },
          });

         

          // const assignData = {
          //   id_operation: operationId,
          //   workersWithSchedule: [{
          //     workerIds: connectOp.workerIds.map(id => Number(id)),
          //     id_group: connectOp.groupId, // ✅ USAR GRUPO EXISTENTE
          //     dateStart: connectOp.dateStart,
          //     dateEnd: connectOp.dateEnd || null,
          //     timeStart: connectOp.timeStart,
          //     timeEnd: connectOp.timeEnd || null,
          //     id_task: connectOp.id_task,
          //     id_subtask: connectOp.id_subtask,
          //     id_tariff: connectOp.id_tariff,
          //   }]
          // };

          const assignData = {
            id_operation: operationId,
            workersWithSchedule: [{
              workerIds: connectOp.workerIds.map(id => Number(id)),
              id_group: connectOp.groupId, // ✅ USAR GRUPO EXISTENTE
              // ✅ HEREDAR VALORES DEL GRUPO EXISTENTE
              dateStart: connectOp.dateStart ?? existingGroupWorker?.dateStart,
              dateEnd: connectOp.dateEnd ?? existingGroupWorker?.dateEnd,
              timeStart: connectOp.timeStart ?? existingGroupWorker?.timeStart,
              timeEnd: connectOp.timeEnd ?? existingGroupWorker?.timeEnd,
              id_task: connectOp.id_task ?? existingGroupWorker?.id_task,
              id_subtask: connectOp.id_subtask ?? existingGroupWorker?.id_subtask,
              id_tariff: connectOp.id_tariff ?? existingGroupWorker?.id_tariff,
              observation: connectOp.observation ?? existingGroupWorker?.observation, // ✅ AGREGAR OBSERVATION
            }]
          };

          console.log('[OperationService] Datos para grupo existente:', assignData);
          const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
          console.log('[OperationService] Agregado a grupo existente:', assignResult);

        } else if (isNewGroup && !isTemporaryGroupId) {
          // ✅ CASO WEB: CREAR NUEVO GRUPO SIN groupId TEMPORAL
          console.log('[OperationService] 🌐 WEB: Creando nuevo grupo');
          
          const assignData = {
            id_operation: operationId,
            workersWithSchedule: [{
              workerIds: connectOp.workerIds.map(id => Number(id)),
              dateStart: connectOp.dateStart,
              dateEnd: connectOp.dateEnd || null,
              timeStart: connectOp.timeStart,
              timeEnd: connectOp.timeEnd || null,
              id_task: connectOp.id_task,
              id_subtask: connectOp.id_subtask,
              id_tariff: connectOp.id_tariff,
              observation: connectOp.observation, // ✅ AGREGAR OBSERVATION
            }]
          };

          console.log('[OperationService] Datos para nuevo grupo (web):', assignData);
          const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
          console.log('[OperationService] Nuevo grupo creado desde web:', assignResult);

        } else {
          // ✅ CASO: ASIGNACIÓN SIMPLE SIN GRUPO
          console.log('[OperationService] ➕ Asignación simple sin grupo específico');
          
          for (const workerId of connectOp.workerIds) {
            if (!workerId || isNaN(Number(workerId))) {
              console.error('[OperationService] ID de trabajador inválido:', workerId);
              throw new BadRequestException(`ID de trabajador inválido: ${workerId}`);
            }

            const assignData = {
              id_operation: operationId,
              workerIds: [Number(workerId)],
            };

            console.log(`[OperationService] Asignación simple trabajador ${workerId}:`, assignData);
            const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
            console.log(`[OperationService] Trabajador ${workerId} asignado:`, assignResult);
          }
        }
      } catch (error) {
        console.error(`[OperationService] Error procesando conexión:`, error);
        throw new BadRequestException(`Error procesando conexión: ${error.message}`);
      }
    }
  }

//------------------------------------- HASTA AQUÍ FUNCIONANDO CORRECTAMENTE -----------------------------

  // 3. ACTUALIZAR TRABAJADORES EXISTENTES

  //------------------------------------- FUNCIONando CORRECTAMENTE DESDE AQUÍ -----------------------------

  if (workersOps.update && workersOps.update.length > 0) {
    // console.log('[OperationService] ===== PROCESANDO UPDATE WORKERS =====');
    // console.log('[OperationService] workersOps.update:', JSON.stringify(workersOps.update, null, 2));
    
    const workersToUpdate = workersOps.update
      .filter(updateOp => updateOp.id_worker && !isNaN(Number(updateOp.id_worker)))
      .map((updateOp: any) => {
        const mapped = {
          id_group: updateOp.id_group,
          workerIds: [Number(updateOp.id_worker)],
          id_task: updateOp.id_task,
          id_subtask: updateOp.id_subtask, // ✅ ASEGURAR QUE SE INCLUYA
          id_tariff: updateOp.id_tariff,
          dateStart: updateOp.dateStart,
          dateEnd: updateOp.dateEnd,
          timeStart: updateOp.timeStart,
          timeEnd: updateOp.timeEnd,
          observation: updateOp.observation, // ✅ AGREGAR OBSERVATION
        };

        // console.log(`[OperationService] Worker ${updateOp.id_worker} mapeado:`, {
        //   id_task: mapped.id_task,
        //   id_subtask: mapped.id_subtask, // ✅ LOG ESPECÍFICO
        //   id_tariff: mapped.id_tariff
        // });

        return mapped;
      });

    // console.log('[OperationService] ===== WORKERS PREPARADOS PARA ACTUALIZAR =====');
    workersToUpdate.forEach((worker, index) => {
      console.log(`Worker ${index + 1}:`, {
        id_group: worker.id_group,
        workerIds: worker.workerIds,
        id_task: worker.id_task,
        id_subtask: worker.id_subtask, // ✅ VERIFICAR QUE ESTÉ AQUÍ
        id_tariff: worker.id_tariff
      });
    });

    if (workersToUpdate.length > 0) {
      try {
        const updateResult = await this.operationWorkerService.updateWorkersSchedule(
          operationId,
          workersToUpdate
        );
        // console.log('[OperationService] Resultado actualización:', updateResult);
      } catch (error) {
        console.error('[OperationService] Error actualizando trabajadores en la operación:', error);
        throw error;
      }
    }
  }



  //------------------------------------- HASTA AQUÍ FUNCIONANDO CORRECTAMENTE -----------------------------
}

  /**
   * Inicializa manualmente las operaciones pendientes que ya deberían estar en progreso
   * @returns Resultado de la inicialización manual
   */
  async initializePendingOperations() {
    try {
      console.log('[OperationService] Inicializando operaciones pendientes manualmente...');
      
      // Importar dinámicamente UpdateOperationService para evitar dependencia circular
      const { UpdateOperationService } = await import('../cron-job/services/update-operation.service');
      const updateOperationService = this.moduleRef.get(UpdateOperationService, { strict: false });
      
      const result = await updateOperationService.updateInProgressOperations();
      
      console.log(`[OperationService] ✅ Resultado de inicialización manual: ${result.updatedCount} operaciones actualizadas`);
      
      return {
        message: `${result.updatedCount} operaciones inicializadas exitosamente`,
        updatedCount: result.updatedCount,
        status: 200
      };
    } catch (error) {
      console.error('[OperationService] ❌ Error en inicialización manual:', error);
      throw new Error(`Error inicializando operaciones: ${error.message}`);
    }
  }

  // **AGREGAR EL MÉTODO PARA PROCESAR ENCARGADOS**
  private async processInChargedOperations(operationId: number, inChargedOps: any) {
    // console.log('[OperationService] Procesando operaciones de encargados:', inChargedOps);

    // ✅ SIEMPRE ELIMINAR TODOS LOS ENCARGADOS EXISTENTES PRIMERO
    await this.prisma.inChargeOperation.deleteMany({
      where: { id_operation: operationId }
    });
    console.log('[OperationService] Eliminados todos los encargados existentes para la operación:', operationId);

    // Conectar nuevos encargados (si los hay)
    if (inChargedOps.connect && inChargedOps.connect.length > 0) {
      // ✅ FILTRAR DUPLICADOS ANTES DE CREAR
      const uniqueConnections = inChargedOps.connect.filter(
        (item, index, self) => index === self.findIndex(i => i.id === item.id)
      );

      console.log('[OperationService] Encargados únicos a conectar:', uniqueConnections);

      if (uniqueConnections.length > 0) {
        const dataToCreate = uniqueConnections.map((op: any) => ({
          id_operation: operationId,
          id_user: Number(op.id),
        }));

        try {
          const result = await this.prisma.inChargeOperation.createMany({
            data: dataToCreate,
            skipDuplicates: true,
          });
          
          console.log(`[OperationService] ${result.count} encargados conectados exitosamente`);
          console.log(`[OperationService] IDs conectados: ${uniqueConnections.map((op: any) => op.id).join(', ')}`);
        } catch (error) {
          console.error('[OperationService] Error creando encargados:', error);
          throw new BadRequestException('Error al asignar encargados a la operación');
        }
      }
    }

    // ✅ NO PROCESAR DISCONNECT PORQUE YA ELIMINAMOS TODOS AL INICIO
    // Esto simplifica la lógica y evita conflictos
  }
  /**
   * Procesa la finalización de grupos actualizando fechas y horas de finalización
   * @param operationId - ID de la operación
   * @param groups - Array de grupos con información de finalización
   */
  private async processGroupsCompletion(operationId: number, groups: any[]) {
    // console.log('[OperationService] ===== PROCESANDO FINALIZACIÓN DE GRUPOS =====');
    // console.log('[OperationService] Grupos a procesar:', JSON.stringify(groups, null, 2));

    for (const group of groups) {
      const { groupId, dateEnd, timeEnd, observation } = group;
      
      if (!groupId) {
        console.warn('[OperationService] Grupo sin groupId, saltando:', group);
        continue;
      }

      // console.log(`[OperationService] Procesando finalización de grupo: ${groupId}`);
      // console.log(`[OperationService] Datos de finalización: dateEnd=${dateEnd}, timeEnd=${timeEnd}, observation=${observation}`);

      try {
        // Preparar datos de actualización
        const updateData: any = {};
        
        if (dateEnd) {
          updateData.dateEnd = new Date(dateEnd);
          console.log(`[OperationService] Estableciendo dateEnd: ${updateData.dateEnd}`);
        }
        
        if (timeEnd) {
          updateData.timeEnd = timeEnd;
          console.log(`[OperationService] Estableciendo timeEnd: ${timeEnd}`);
        }

        if (observation !== undefined) {
          updateData.observation = observation;
          console.log(`[OperationService] Estableciendo observation: ${observation}`);
        }

        // Solo actualizar si hay datos para actualizar
        if (Object.keys(updateData).length > 0) {
          const result = await this.prisma.operation_Worker.updateMany({
            where: {
              id_operation: operationId,
              id_group: groupId,
            },
            data: updateData,
          });

          console.log(`[OperationService] Grupo ${groupId} finalizado. Trabajadores afectados: ${result.count}`);
        } else {
          console.log(`[OperationService] No hay datos de finalización para grupo ${groupId}`);
        }
      } catch (error) {
        console.error(`[OperationService] Error finalizando grupo ${groupId}:`, error);
        throw new BadRequestException(`Error finalizando grupo ${groupId}: ${error.message}`);
      }
    }
    
    console.log('[OperationService] ===== FINALIZACIÓN DE GRUPOS COMPLETADA =====');
  }
}
