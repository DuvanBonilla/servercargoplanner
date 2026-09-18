import { Injectable } from '@nestjs/common';
import { CreateFeedingDto } from './dto/create-feeding.dto';
import { UpdateFeedingDto } from './dto/update-feeding.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { ValidationService } from 'src/common/validation/validation.service';
import { FilterWorkerFeedingDto } from './dto/filter-worker-feeding.dto';
import { PaginationFeedingService } from 'src/common/services/pagination/feeding/pagination-feeding.service';
import { CreateBulkFeedingDto } from './dto/create-bulk-feeding.dto';
import { CreateFeedingAddedToServiceDto } from './dto/create-feeding-added-to-service.dto';
import { FeedingStatus } from '@prisma/client';
import {
  FEEDING_TYPE_NAMES,
  MEAL_SCHEDULE,
} from './constants/meal-schedule.constant';

@Injectable()
export class FeedingService {
  constructor(
    private prisma: PrismaService,
    private validation: ValidationService,
    private paginationService: PaginationFeedingService,
  ) {}

  private toDateStr(d: Date | string): string {
    return new Date(d).toISOString().split('T')[0];
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

      // Fecha objetivo del registro: la que envía el cliente (cualquier fecha
      // dentro del rango del grupo, ya no solo "hoy") o la actual si se omite.
      const feedingDate = createFeedingDto.dateFeeding
        ? new Date(createFeedingDto.dateFeeding)
        : new Date();
      const dateOnlyStr = this.toDateStr(feedingDate);
      const dayStart = new Date(`${dateOnlyStr}T00:00:00.000Z`);
      const dayEnd = new Date(`${dateOnlyStr}T23:59:59.999Z`);

      // Un trabajador solo puede tener un registro por tipo por fecha.
      const existingFeeding = await this.prisma.workerFeeding.findFirst({
        where: {
          id_worker: createFeedingDto.id_worker,
          type: createFeedingDto.type,
          dateFeeding: { gte: dayStart, lte: dayEnd },
        },
      });

      if (existingFeeding) {
        return {
          message: `El trabajador ya tiene registrado un ${FEEDING_TYPE_NAMES[createFeedingDto.type]} para el ${dateOnlyStr}`,
          status: 409,
        };
      }

      const response = await this.prisma.workerFeeding.create({
        data: {
          id_worker: createFeedingDto.id_worker,
          id_operation: createFeedingDto.id_operation,
          id_user: createFeedingDto.id_user,
          type: createFeedingDto.type,
          dateFeeding: feedingDate,
        },
      });
      if (!response) {
        return { message: 'Feeding not created', status: 404 };
      }
      return response;
    } catch (error) {
      throw new Error(String(error));
    }
  }

  /**
   * Registra una alimentación adherida al GRUPO (OperationGroup) de una
   * operación, no a un trabajador específico. Se usa cuando la comida llega
   * para todo el grupo pero uno o más trabajadores ya no están disponibles
   * para recibirla de forma individual (ej. se retiraron de la operación),
   * de modo que el conteo total del reporte Bill siga reflejando la cantidad
   * real de alimentaciones entregadas.
   */
  async feedingAddedToService(
    dto: CreateFeedingAddedToServiceDto,
    id_site?: number,
  ) {
    try {
      const validation = await this.validation.validateAllIds({
        id_operation: dto.id_operation,
      });
      if (validation && 'status' in validation && validation.status === 404) {
        return validation;
      }

      const operation = validation['operation'];
      if (id_site !== undefined && operation?.id_site !== id_site) {
        return {
          message: 'Not authorized to create feeding for this operation',
          status: 409,
        };
      }

      const operationGroup = await this.prisma.operationGroup.findFirst({
        where: {
          id_operation: dto.id_operation,
          code: String(dto.code_group),
        },
      });

      if (!operationGroup) {
        return {
          message: `No se encontró el grupo con código ${dto.code_group} para esta operación`,
          status: 404,
        };
      }

      const feedingDate = dto.dateFeeding
        ? new Date(dto.dateFeeding)
        : new Date();

      // Cada unidad solicitada (ej. 2 almuerzos + 1 desayuno extra) se
      // registra como un registro independiente por tipo, igual que
      // ocurriría si fueran trabajadores distintos, para que el conteo del
      // reporte Bill sea exacto.
      const rowsToInsert = dto.items.flatMap((item) => {
        const quantity = item.quantity ?? 1;
        return Array.from({ length: quantity }, () => ({
          id_operation: dto.id_operation,
          code_group: dto.code_group,
          type: item.type,
          id_user: dto.id_user,
          dateFeeding: feedingDate,
        }));
      });

      await this.prisma.workerFeeding.createMany({ data: rowsToInsert });

      const createdByType = await this.prisma.workerFeeding.findMany({
        where: {
          id_operation: dto.id_operation,
          code_group: dto.code_group,
          type: { in: dto.items.map((item) => item.type) },
          dateFeeding: feedingDate,
        },
        orderBy: { id: 'desc' },
        take: rowsToInsert.length,
      });

      const summary = dto.items.map((item) => ({
        type: item.type,
        quantity: item.quantity ?? 1,
      }));

      return {
        message: `Se registraron ${rowsToInsert.length} alimentaciones para el grupo ${dto.code_group}`,
        summary,
        feedings: createdByType,
      };
    } catch (error) {
      throw new Error(String(error));
    }
  }

  /**
   * Roster de alimentación de un grupo: trabajadores del grupo, fechas
   * disponibles a registrar (entre dateStart y dateEnd), tipos sugeridos por
   * defecto en cada fecha (según las horas en que el grupo estuvo activo ese
   * día) y quiénes ya tienen cada tipo registrado en cada fecha (para
   * excluirlos de la selección). Reemplaza a los antiguos endpoints
   * available-meals / missing-meals / pending-inprogress: ya no se calcula
   * nada en base a la hora actual, solo en base al rango de trabajo real del
   * grupo.
   *
   * @param dateEndStr / timeEndStr: permiten pasar una fecha/hora de fin
   * *candidata*, aún no guardada (caso del flujo "Completar grupo", donde el
   * usuario recién confirmó la fecha de fin pero todavía no se persiste).
   * Si se omiten, se usa el dateEnd/timeEnd ya guardado del grupo, o "ahora"
   * si el grupo sigue en curso.
   */
  async getGroupFeedingRoster(
    operationId: number,
    groupCode: string,
    dateStartStr?: string,
    dateEndStr?: string,
    timeEndStr?: string,
  ) {
    // El identificador de grupo que usa el frontend (WorkerGroup.id) es en
    // realidad Operation_Worker.id_group (el bucket interno de agrupación),
    // no OperationGroup.code — ese código solo se genera como side-effect al
    // asignar trabajadores y nunca se expone en las respuestas de operación
    // que consume el frontend. Por eso se busca directo por id_group.
    const groupWorkers = await this.prisma.operation_Worker.findMany({
      where: { id_operation: operationId, id_group: groupCode },
      select: {
        id_worker: true,
        dateStart: true,
        dateEnd: true,
        timeStart: true,
        timeEnd: true,
        worker: { select: { id: true, name: true, dni: true } },
      },
    });

    if (groupWorkers.length === 0) {
      return { workers: [], dates: [], suggestedTypesByDate: {}, registeredByDate: {} };
    }

    const combineDateTime = (date: Date | string, time?: string | null): Date => {
      const dStr = this.toDateStr(date);
      const [h, m] = (time || '00:00').split(':').map(Number);
      return new Date(
        `${dStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`,
      );
    };

    // Rango real en que el grupo estuvo activo: mínimo dateStart+timeStart y
    // máximo dateEnd+timeEnd entre todos sus trabajadores.
    let groupStartDateTime: Date | null = null;
    let groupEndDateTime: Date | null = null;
    let groupIsOpen = false;

    for (const w of groupWorkers) {
      if (!w.dateStart) continue;
      const start = combineDateTime(w.dateStart, w.timeStart);
      if (!groupStartDateTime || start < groupStartDateTime) {
        groupStartDateTime = start;
      }
      if (w.dateEnd) {
        const end = combineDateTime(w.dateEnd, w.timeEnd);
        if (!groupEndDateTime || end > groupEndDateTime) {
          groupEndDateTime = end;
        }
      } else {
        groupIsOpen = true;
      }
    }

    if (!groupStartDateTime) {
      const operation = await this.prisma.operation.findUnique({
        where: { id: operationId },
        select: { dateStart: true, timeStrat: true },
      });
      if (operation) {
        groupStartDateTime = combineDateTime(operation.dateStart, operation.timeStrat);
      }
    }
    if (!groupStartDateTime) {
      return { workers: [], dates: [], suggestedTypesByDate: {}, registeredByDate: {} };
    }

    // Fecha/hora de fin candidata (aún no guardada) tiene prioridad sobre la
    // guardada en BD; si no hay ninguna y el grupo sigue abierto, usar ahora.
    const now = new Date();
    const effectiveEndDateTime = dateEndStr
      ? combineDateTime(dateEndStr, timeEndStr ?? '23:59')
      : groupIsOpen || !groupEndDateTime
        ? now
        : groupEndDateTime;

    const rangeStartStr = dateStartStr ?? this.toDateStr(groupStartDateTime);
    const rangeEndStr = dateEndStr ?? this.toDateStr(effectiveEndDateTime);

    const dates: string[] = [];
    const cursor = new Date(`${rangeStartStr}T00:00:00.000Z`);
    const rangeEnd = new Date(`${rangeEndStr}T00:00:00.000Z`);
    while (cursor <= rangeEnd) {
      dates.push(this.toDateStr(cursor));
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }

    const mealTypes = Object.keys(MEAL_SCHEDULE) as FeedingStatus[];
    const suggestedTypesByDate: Record<string, FeedingStatus[]> = {};
    for (const date of dates) {
      const dayStartAbs = new Date(`${date}T00:00:00.000Z`).getTime();
      const dayEndAbs = new Date(`${date}T23:59:59.999Z`).getTime();
      const activeStartAbs = Math.max(groupStartDateTime.getTime(), dayStartAbs);
      const activeEndAbs = Math.min(effectiveEndDateTime.getTime(), dayEndAbs);

      if (activeStartAbs >= activeEndAbs) {
        suggestedTypesByDate[date] = [];
        continue;
      }
      const activeStartMin = Math.floor((activeStartAbs - dayStartAbs) / 60000);
      const activeEndMin = Math.ceil((activeEndAbs - dayStartAbs) / 60000);

      suggestedTypesByDate[date] = mealTypes.filter((type) => {
        const w = MEAL_SCHEDULE[type];
        return activeStartMin < w.end && activeEndMin > w.start;
      });
    }

    const workerIds = groupWorkers.map((w) => w.id_worker);
    const feedings = await this.prisma.workerFeeding.findMany({
      where: {
        id_worker: { in: workerIds },
        dateFeeding: {
          gte: new Date(`${rangeStartStr}T00:00:00.000Z`),
          lte: new Date(`${rangeEndStr}T23:59:59.999Z`),
        },
      },
      select: { id_worker: true, type: true, dateFeeding: true },
    });

    const registeredByDate: Record<string, Partial<Record<FeedingStatus, number[]>>> = {};
    for (const f of feedings) {
      if (f.id_worker == null) continue;
      const dStr = this.toDateStr(f.dateFeeding);
      if (!registeredByDate[dStr]) registeredByDate[dStr] = {};
      const byType = registeredByDate[dStr];
      if (!byType[f.type]) byType[f.type] = [];
      byType[f.type]!.push(f.id_worker);
    }

    return {
      workers: groupWorkers.map((w) => ({
        id: w.worker.id,
        name: w.worker.name,
        dni: w.worker.dni,
      })),
      dates,
      suggestedTypesByDate,
      registeredByDate,
    };
  }

  async findAll(id_site?: number, id_subsite?: number | null) {
    try {
      const workerFilter: any = {};
      const operationFilter: any = {};

      // Siempre filtra por sitio si viene
      if (id_site) {
        workerFilter.id_site = id_site;
        operationFilter.id_site = id_site;
      }

      // Solo filtra por subsede si es un número válido
      if (typeof id_subsite === 'number' && !isNaN(id_subsite)) {
        workerFilter.id_subsite = id_subsite;
        operationFilter.id_subsite = id_subsite;
      }

      // Las alimentaciones adheridas al grupo (id_worker null, ver
      // feedingAddedToService) no tienen worker propio, así que se filtran
      // por el sitio/subsede de la operación en su lugar.
      const whereClause: any =
        Object.keys(workerFilter).length > 0
          ? {
              OR: [
                { worker: workerFilter },
                { id_worker: null, operation: operationFilter },
              ],
            }
          : {};

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
                },
              },
            },
          },
          worker: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      if (!response || response.length === 0) {
        return []; // Retornar array vacío en lugar de 404
      }
      return response.map((feeding) => ({
        ...feeding,
        serviceName: feeding.operation?.task?.name || null,
        workerName: feeding.worker?.name || null,
        userName: feeding.user?.name || null,
      }));
    } catch (error) {
      throw new Error(String(error));
    }
  }

  async findOne(id: number, id_site?: number) {
    try {
      const response = await this.prisma.workerFeeding.findUnique({
        where: {
          id,
          ...(id_site !== undefined && {
            OR: [
              { worker: { id_site } },
              // Alimentación adherida al grupo (sin worker propio)
              { id_worker: null, operation: { id_site } },
            ],
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
                },
              },
            },
          },
          worker: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
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
      throw new Error(String(error));
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
      throw new Error((error as Error).message);
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
            OR: [
              { worker: { id_site } },
              // Alimentaciones adheridas al grupo (sin worker propio)
              { id_worker: null },
            ],
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
                },
              },
            },
          },
          worker: {
            select: {
              id: true,
              name: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });
      // if (!response || response.length === 0) {
      //   return { message: 'Feeding not found', status: 404 };
      // }
      if (!response || response.length === 0) {
    return [];
}
      return response.map((feeding) => ({
        ...feeding,
        serviceName: feeding.operation?.task?.name || null,
        workerName: feeding.worker?.name || null,
        userName: feeding.user?.name || null,
      }));
    } catch (error) {
      throw new Error(String(error));
    }
  }

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
        const targetDate = updateFeedingDto.dateFeeding
          ? new Date(updateFeedingDto.dateFeeding)
          : new Date(validate['dateFeeding']);
        const dateOnlyStr = this.toDateStr(targetDate);
        const dayStart = new Date(`${dateOnlyStr}T00:00:00.000Z`);
        const dayEnd = new Date(`${dateOnlyStr}T23:59:59.999Z`);

        const existingFeeding = await this.prisma.workerFeeding.findFirst({
          where: {
            id_worker: updateFeedingDto.id_worker || validate['id_worker'],
            type: updateFeedingDto.type,
            dateFeeding: {
              gte: dayStart,
              lte: dayEnd,
            },
            NOT: {
              id: id, // Excluir el registro actual
            },
          },
        });

        if (existingFeeding) {
          return {
            message: `El trabajador ya tiene registrado un ${FEEDING_TYPE_NAMES[updateFeedingDto.type]} para el ${dateOnlyStr}`,
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
      throw new Error(String(error));
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
      throw new Error(String(error));
    }
  }

  private toDateOnlyUTC(dateStr: string): Date {
    return new Date(`${dateStr}T00:00:00.000Z`);
  }

  async createBulk(dto: CreateBulkFeedingDto, id_site: number, id_subsite: number) {
    const operation = await this.prisma.operation.findUnique({
      where: { id: dto.id_operation },
      select: { id: true, id_site: true },
    });

    if (!operation) {
      return { status: 404, message: 'Operación no encontrada' };
    }

    if (operation.id_site !== id_site) {
      return {
        status: 409,
        message: 'No autorizado para registrar alimentaciones en esta operación',
      };
    }

    const workerIds = [...new Set(dto.items.map((item) => item.id_worker))];

    const workers = await this.prisma.worker.findMany({
      where: { id: { in: workerIds }, id_site },
      select: { id: true },
    });

    const validWorkerSet = new Set(workers.map((worker) => worker.id));
    const invalidWorkers = workerIds.filter((id) => !validWorkerSet.has(id));

    if (invalidWorkers.length > 0) {
      return {
        status: 404,
        message: `Los siguientes trabajadores no existen o no pertenecen al sitio: ${invalidWorkers.join(', ')}`,
      };
    }

    type FailedItem = {
      id_worker: number;
      type: string;
      dateFeeding: string;
      reason: string;
    };

    const failed: FailedItem[] = [];
    const toInsert: {
      id_worker: number;
      type: any;
      dateFeeding: Date;
      id_operation: number;
      id_user?: number;
    }[] = [];
    const batchKeys = new Set<string>();

    // Un trabajador solo puede tener un registro por tipo por fecha: se
    // deduplica dentro del propio payload antes de tocar la base de datos.
    for (const item of dto.items) {
      const rawDate = item.dateFeeding ?? dto.dateFeeding;
      const dateOnly = rawDate
        ? rawDate.split(' ')[0]
        : new Date().toISOString().split('T')[0];
      const batchKey = `${item.id_worker}-${item.type}-${dateOnly}`;
      if (batchKeys.has(batchKey)) {
        continue;
      }
      batchKeys.add(batchKey);
      toInsert.push({
        id_worker: item.id_worker,
        type: item.type,
        dateFeeding: this.toDateOnlyUTC(dateOnly),
        id_operation: dto.id_operation,
        id_user: dto.id_user,
      });
    }

    if (toInsert.length === 0) {
      return {
        summary: { total: dto.items.length, created: 0, failed: failed.length },
        created: [],
        failed,
      };
    }

    const existingFeedings = await this.prisma.workerFeeding.findMany({
      where: {
        id_worker: { in: [...new Set(toInsert.map((item) => item.id_worker))] },
        type: { in: [...new Set(toInsert.map((item) => item.type))] },
        id_operation: dto.id_operation,
      },
      select: { id_worker: true, type: true, dateFeeding: true },
    });

    const existingSet = new Set(
      existingFeedings.map(
        (feeding) =>
          `${feeding.id_worker}-${feeding.type}-${feeding.dateFeeding.toISOString().split('T')[0]}`,
      ),
    );

    const finalInsert: typeof toInsert = [];
    for (const item of toInsert) {
      const dateOnly = item.dateFeeding.toISOString().split('T')[0];
      const key = `${item.id_worker}-${item.type}-${dateOnly}`;
      if (!existingSet.has(key)) {
        finalInsert.push(item);
        continue;
      }
      const reason = `El trabajador ${item.id_worker} ya tiene registrado un ${FEEDING_TYPE_NAMES[item.type as FeedingStatus] ?? item.type} para el ${dateOnly}`;
      if (dto.stopOnError) {
        return { status: 409, message: reason, failedItem: item };
      }
      failed.push({
        id_worker: item.id_worker,
        type: item.type,
        dateFeeding: dateOnly,
        reason,
      });
    }

    if (finalInsert.length === 0) {
      return {
        summary: { total: dto.items.length, created: 0, failed: failed.length },
        created: [],
        failed,
      };
    }

    await this.prisma.workerFeeding.createMany({ data: finalInsert });

    const created = await this.prisma.workerFeeding.findMany({
      where: {
        id_operation: dto.id_operation,
        id_worker: { in: [...new Set(finalInsert.map((item) => item.id_worker))] },
        type: { in: [...new Set(finalInsert.map((item) => item.type))] },
        dateFeeding: { in: finalInsert.map((item) => item.dateFeeding) },
      },
      select: {
        id: true,
        id_worker: true,
        type: true,
        dateFeeding: true,
        id_operation: true,
      },
    });

    return {
      summary: {
        total: dto.items.length,
        created: created.length,
        failed: failed.length,
      },
      created,
      failed,
    };
  }
}
