import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
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
      if (createOperationDto.id_subsite) {
        id_subsite = createOperationDto.id_subsite;
      }

      // Obtener el usuario y su rol (ajusta según tu modelo)
      const user = await this.prisma.user.findUnique({
        where: { id: createOperationDto.id_user },
        select: { role: true },
      });

      // Validar fecha para SUPERVISOR
      if (user?.role === 'SUPERVISOR' && createOperationDto.dateStart) {
        // Si el usuario existe y su rol es 'SUPERVISOR', y además se proporcionó dateStart en el DTO
        const now = new Date(); // Obtener la fecha/hora actual
        const dateStart = new Date(createOperationDto.dateStart); // Convertir la fecha proporcionada a un objeto Date
        const diffMs = now.getTime() - dateStart.getTime(); // Calcular la diferencia en milisegundos entre ahora y dateStart
        const diffHours = diffMs / (1000 * 60 * 60); // Convertir la diferencia de ms a horas: $diffHours = \\frac{diffMs}{1000\\times60\\times60}$
        
        if (diffHours >= 120) {
          // Si la diferencia es mayor o igual a 120 horas (5 días), devolver un objeto con mensaje y estado 400
          return {
            message:
              'Como SUPERVISOR solo puedes crear operaciones con máximo o igual a 120 horas de antigüedad.',
            status: 400,
          };
        }
      }

      // Validaciones
      if (createOperationDto.id_user === undefined) {
        return { message: 'User ID is required', status: 400 };
      }

      // Extraer y validar IDs de trabajadores
      const { workerIds = [], groups = [] } = createOperationDto;
      const scheduledWorkerIds =
        this.relationService.extractScheduledWorkerIds(groups);
      const allWorkerIds = [...workerIds, ...scheduledWorkerIds];

      const validateWorkerIds = await this.relationService.validateWorkerIds(
        allWorkerIds,
        id_subsite,
        id_site,
      );
      if (validateWorkerIds?.status === 403) {
        return validateWorkerIds;
      }
      //validar programacion cliente
      const validateClientProgramming =
        await this.relationService.validateClientProgramming(
          createOperationDto.id_clientProgramming || null,
        );

      if (validateClientProgramming) return validateClientProgramming;

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

      if (
        validationResult &&
        validationResult.status &&
        validationResult.status !== 200
      ) {
        return validationResult;
      }

      // Crear la operación
      const operation = await this.createOperation(
        createOperationDto,
        id_subsite,
      );

      // VERIFICAR SI HAY ERROR ANTES DE ACCEDER A 'id'
      if ('status' in operation && 'message' in operation) {
        return operation;
      }
      // Asignar trabajadores y encargados
      const response = await this.relationService.assignWorkersAndInCharge(
        operation.id,
        workerIds,
        groups,
        createOperationDto.inChargedIds || [],
        id_subsite,
        id_site,
      );
      if (response && (response.status === 403 || response.status === 400)) {
        return response;
      }
      return { id: operation.id };
    } catch (error) {
      console.error('Error creating operation with workers:', error);
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

    // Process workers
    if (workers) {
      console.log('[OperationService] Procesando workers con nuevo flujo V2');
      await this.processWorkersOperationsV2(id, workers);
    }

    // ✅ PROCESAR GRUPOS (FINALIZACIÓN DE GRUPOS)
    if (groups && Array.isArray(groups) && groups.length > 0) {
      console.log('[OperationService] Procesando finalización de grupos:', groups);
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

    // Handle status change
    // if (directFields.status === StatusOperation.COMPLETED) {
    //   const operation = await this.prisma.operation.findUnique({
    //     where: { id },
    //   });

    //   if (
    //     operation &&
    //     operation.dateStart &&
    //     operation.timeStrat &&
    //     operation.dateEnd &&
    //     operation.timeEnd
    //   ) {
    //     const opDuration = this.calculateOperationDuration(
    //       operation.dateStart,
    //       operation.timeStrat,
    //       operation.dateEnd,
    //       operation.timeEnd,
    //     );

    //     // Actualiza el campo op_duration
    //     await this.prisma.operation.update({
    //       where: { id },
    //       data: { op_duration: opDuration },
    //     });
    //   }

    //   // ✅ CAMBIAR EL ORDEN: PRIMERO ACTUALIZAR FECHAS, LUEGO CALCULAR HORAS
    //   await this.operationWorkerService.completeClientProgramming(id);
    //   await this.operationWorkerService.releaseAllWorkersFromOperation(id);
    //   await this.workerService.addWorkedHoursOnOperationEnd(id);

    //   // // Intentar crear factura automáticamente (mismo comportamiento que el cron)
    //   // try {
    //   //   const operationWorkers = await this.prisma.operation_Worker.findMany({
    //   //     where: { id_operation: id },
    //   //     select: { id_worker: true, id_group: true },
    //   //   });

    //   //   const uniqueGroups = [
    //   //     ...new Set(operationWorkers.map((ow) => ow.id_group)),
    //   //   ];

    //   //   const billGroups = uniqueGroups.map((groupId) => ({
    //   //     id: String(groupId),
    //   //     amount: 0,
    //   //     group_hours: 0,
    //   //     pays: operationWorkers
    //   //       .filter((ow) => ow.id_group === groupId)
    //   //       .map((ow) => ({
    //   //         id_worker: ow.id_worker,
    //   //         pay: 0,
    //   //       })),
    //   //     paysheetHoursDistribution: {
    //   //       HOD: 0,
    //   //       HON: 0,
    //   //       HED: 0,
    //   //       HEN: 0,
    //   //       HFOD: 0,
    //   //       HFON: 0,
    //   //       HFED: 0,
    //   //       HFEN: 0,
    //   //     },
    //   //     billHoursDistribution: {
    //   //       HOD: 0,
    //   //       HON: 0,
    //   //       HED: 0,
    //   //       HEN: 0,
    //   //       HFOD: 0,
    //   //       HFON: 0,
    //   //       HFED: 0,
    //   //       HFEN: 0,
    //   //     },
    //   //   }));

    //   //   const createBillDto = {
    //   //     id_operation: id,
    //   //     groups: billGroups,
    //   //   };

    //   //   // await this.billService.create(createBillDto, 1);
    //   //   // console.log(`[OperationService] Factura automática creada para operación ${id}`);
    //   // } catch (billError) {
    //   //   console.error('[OperationService] Error creando factura automática:', billError);
    //   // }
    // }
const hasDateTimeChanges = dateStart || dateEnd || timeStrat || timeEnd;
    
    console.log('[OperationService] 🔍 Verificando cambios de fecha/hora:');
    console.log('   - dateStart presente:', !!dateStart);
    console.log('   - dateEnd presente:', !!dateEnd);
    console.log('   - timeStrat presente:', !!timeStrat);
    console.log('   - timeEnd presente:', !!timeEnd);
    console.log('   - hasDateTimeChanges:', hasDateTimeChanges);
    
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
          console.log('[OperationService] 🔄 Operación COMPLETED con cambio de duración, buscando factura...');
          
          try {
            // Buscar la factura de esta operación
            const bill = await this.prisma.bill.findFirst({
              where: { id_operation: id },
            });

            if (bill) {
              console.log(`[OperationService] 📄 Factura encontrada (ID: ${bill.id}), recalculando compensatorio...`);
              
              // Importar dinámicamente BillService para evitar dependencia circular
              const { BillService } = await import('../bill/bill.service');
              const billService = this.moduleRef.get(BillService, { strict: false });
              
              // Recalcular la factura completa
              await billService.recalculateBillAfterOpDurationChange(bill.id, id);
              
              console.log(`[OperationService] ✅ Factura ${bill.id} recalculada con nuevo compensatorio`);
            } else {
              console.log('[OperationService] ⚠️ No se encontró factura para esta operación');
            }
          } catch (error) {
            console.error('[OperationService] ❌ Error recalculando factura:', error.message);
            // No lanzar error para no bloquear la actualización de la operación
          }
        }
      } else {
        console.log('[OperationService] ⚠️ No se puede calcular op_duration:');
        console.log('   - Operación existe:', !!updatedOp);
        console.log('   - dateStart existe:', !!updatedOp?.dateStart);
        console.log('   - timeStrat existe:', !!updatedOp?.timeStrat);
        console.log('   - dateEnd existe:', !!updatedOp?.dateEnd);
        console.log('   - timeEnd existe:', !!updatedOp?.timeEnd);
      }
    } else {
      console.log('[OperationService] ℹ️ No se detectaron cambios en fechas/horas, no se recalcula op_duration');
    }

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
   * @returns Objeto con datos preparados para actualizar
   */
  private prepareOperationUpdateData(
    directFields: any,
    dateStart?: string,
    dateEnd?: string,
    timeStrat?: string,
    timeEnd?: string,
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

          console.log(`[OperationService] 🔍 Validando semana para SUPERVISOR:`);
          console.log(`   - Semana actual: ${currentWeekNumber}`);
          console.log(`   - Semana de la factura: ${billInGroup.week_number}`);

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
        // 1. Si hay factura ACTIVE, eliminar detalles y factura
        if (billInGroup && billInGroup.status === 'ACTIVE') {
          console.log(
            `[OperationService] Eliminando detalles de factura ${billInGroup.id} del grupo ${id_group}`,
          );

          // Eliminar BillDetails asociados a esta factura
          await tx.billDetail.deleteMany({
            where: { id_bill: billInGroup.id },
          });

          // Eliminar la factura
          await tx.bill.delete({
            where: { id: billInGroup.id },
          });
        }

        // 2. Eliminar WorkerFeeding del grupo
        const workersInGroup = await tx.operation_Worker.findMany({
          where: {
            id_operation: id,
            id_group: id_group,
          },
          select: { id_worker: true },
        });

        const workerIds = workersInGroup.map((w) => w.id_worker);

        if (workerIds.length > 0) {
          await tx.workerFeeding.deleteMany({
            where: {
              id_operation: id,
              id_worker: { in: workerIds },
            },
          });
        }

        // 3. Eliminar trabajadores del grupo
        const deletedWorkers = await tx.operation_Worker.deleteMany({
          where: {
            id_operation: id,
            id_group: id_group,
          },
        });

        // 4. Liberar trabajadores si ya no están en otras operaciones
        for (const workerId of workerIds) {
          const remainingAssignments = await tx.operation_Worker.count({
            where: { id_worker: workerId },
          });

          if (remainingAssignments === 0) {
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
        // Solo hay un grupo, eliminarlo automáticamente
        console.log(
          `[OperationService] Solo hay un grupo (${uniqueGroups[0]}), eliminando automáticamente`,
        );
        return await this.removeGroup(
          id,
          uniqueGroups[0],
          id_site,
          id_subsite,
          userId,
        );
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

  private async processWorkersOperationsV2(operationId: number, workersOps: any) {
  console.log('[OperationService] Procesando operaciones de trabajadores V2:', JSON.stringify(workersOps, null, 2));

  // 1. DESCONECTAR/ELIMINAR TRABAJADORES (mantener igual)
  if (workersOps.disconnect && Array.isArray(workersOps.disconnect) && workersOps.disconnect.length > 0) {
    // console.log('[OperationService] Eliminando trabajadores:', workersOps.disconnect);
    
    for (const disconnectOp of workersOps.disconnect) {
      console.log('[OperationService] Procesando eliminación individual:', disconnectOp);
      
      if (!disconnectOp.id || isNaN(Number(disconnectOp.id))) {
        console.error('[OperationService] ID de trabajador inválido:', disconnectOp.id);
        throw new BadRequestException(`ID de trabajador inválido: ${disconnectOp.id}`);
      }
      
      const workerId = Number(disconnectOp.id);
      console.log('[OperationService] ID de trabajador convertido a número:', workerId);
      
      try {
        if (disconnectOp.id_group) {
          console.log('[OperationService] Eliminando trabajador del grupo específico');
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
      
      console.log(`[OperationService] 🔍 Análisis de grupo:`);
      console.log(`[OperationService] - connectOp.groupId: ${connectOp.groupId}`);
      console.log(`[OperationService] - isTemporaryGroupId: ${isTemporaryGroupId}`);
      console.log(`[OperationService] - connectOp.isNewGroup: ${connectOp.isNewGroup}`);
      console.log(`[OperationService] - isRealExistingGroup: ${isRealExistingGroup}`);

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
              // ✅ NO incluir id_group - Se genera automáticamente
            }]
          };

          console.log('[OperationService] Datos para nuevo grupo (móvil):', assignData);
          const assignResult = await this.operationWorkerService.assignWorkersToOperation(assignData);
          console.log('[OperationService] Nuevo grupo creado desde móvil:', assignResult);

        } else if (isRealExistingGroup) {
          // ✅ CASO: AGREGAR A GRUPO EXISTENTE REAL
          console.log('[OperationService] 🔗 Agregando a grupo existente real:', connectOp.groupId);
          
          const assignData = {
            id_operation: operationId,
            workersWithSchedule: [{
              workerIds: connectOp.workerIds.map(id => Number(id)),
              id_group: connectOp.groupId, // ✅ USAR GRUPO EXISTENTE
              dateStart: connectOp.dateStart,
              dateEnd: connectOp.dateEnd || null,
              timeStart: connectOp.timeStart,
              timeEnd: connectOp.timeEnd || null,
              id_task: connectOp.id_task,
              id_subtask: connectOp.id_subtask,
              id_tariff: connectOp.id_tariff,
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
    console.log('[OperationService] ===== PROCESANDO UPDATE WORKERS =====');
    console.log('[OperationService] workersOps.update:', JSON.stringify(workersOps.update, null, 2));
    
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
        };

        console.log(`[OperationService] Worker ${updateOp.id_worker} mapeado:`, {
          id_task: mapped.id_task,
          id_subtask: mapped.id_subtask, // ✅ LOG ESPECÍFICO
          id_tariff: mapped.id_tariff
        });

        return mapped;
      });

    console.log('[OperationService] ===== WORKERS PREPARADOS PARA ACTUALIZAR =====');
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
        console.log('[OperationService] Resultado actualización:', updateResult);
      } catch (error) {
        console.error('[OperationService] Error actualizando trabajadores:', error);
        throw error;
      }
    }
  }



  //------------------------------------- HASTA AQUÍ FUNCIONANDO CORRECTAMENTE -----------------------------
}

  // **AGREGAR EL MÉTODO PARA PROCESAR ENCARGADOS**
  private async processInChargedOperations(operationId: number, inChargedOps: any) {
    console.log('[OperationService] Procesando operaciones de encargados:', inChargedOps);

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
    console.log('[OperationService] ===== PROCESANDO FINALIZACIÓN DE GRUPOS =====');
    console.log('[OperationService] Grupos a procesar:', JSON.stringify(groups, null, 2));

    for (const group of groups) {
      const { groupId, dateEnd, timeEnd } = group;
      
      if (!groupId) {
        console.warn('[OperationService] Grupo sin groupId, saltando:', group);
        continue;
      }

      console.log(`[OperationService] Procesando finalización de grupo: ${groupId}`);
      console.log(`[OperationService] Datos de finalización: dateEnd=${dateEnd}, timeEnd=${timeEnd}`);

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
