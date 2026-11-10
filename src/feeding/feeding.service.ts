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
import { FEEDING_TYPE_NAMES } from './constants/meal-schedule.constant';
import * as ExcelJS from 'exceljs';
import {
  formatColombianISODate,
  getColombianTimeOfDayFraction,
} from 'src/common/utils/dateColombia';

// Etiquetas del reporte Excel (mismas que usaba el front)
const FEEDING_TYPE_LABELS: Record<FeedingStatus, string> = {
  BREAKFAST: 'Desayuno',
  LUNCH: 'Almuerzo',
  DINNER: 'Cena',
  SNACK: 'Media noche',
};

// Fecha de solo día (@db.Date, medianoche UTC) → número de serie de Excel
const toExcelDateSerial = (date?: Date | null): number | string => {
  if (!date) return '';
  const excelEpoch = Date.UTC(1899, 11, 30);
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((target - excelEpoch) / 86400000);
};

// Hora "HH:mm[:ss]" → fracción de día para Excel
const timeStringToExcelFraction = (time?: string | null): number | string => {
  if (!time) return '';
  const [h, m, s = '0'] = time.split(':');
  const hours = parseInt(h, 10);
  const minutes = parseInt(m, 10);
  if (Number.isNaN(hours) || Number.isNaN(minutes)) return 'N/A';
  return (hours * 3600 + minutes * 60 + (parseInt(s, 10) || 0)) / 86400;
};

// Semana ISO 8601 (lunes a domingo) de una fecha de solo día
const getIsoWeekNumber = (date: Date): number => {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / 86400000 + 1) / 7);
};

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
   * disponibles a registrar (entre dateStart y dateEnd) y quiénes ya tienen
   * cada tipo registrado en cada fecha (para marcarlos como ya recibidos).
   * Los 4 tipos de comida siempre están disponibles: el backend ya no
   * sugiere ni filtra tipos por franja horaria. Reemplaza a los antiguos
   * endpoints available-meals / missing-meals / pending-inprogress.
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
      return { workers: [], dates: [], registeredByDate: {} };
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
      return { workers: [], dates: [], registeredByDate: {} };
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
              // Datos que muestra el detalle de alimentación en la web
              // (ViewFeedingDialog): área, cliente, embarcación e inicio.
              dateStart: true,
              timeStrat: true,
              motorShip: true,
              client: { select: { name: true } },
              jobArea: { select: { name: true } },
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

  /**
   * Genera el reporte Excel de alimentación con los mismos filtros de
   * /feeding/paginated. Incluye la columna "Grupo" (OperationGroup.code),
   * resuelta igual que en el reporte de Bill:
   * - Alimentación con code_group (extra del grupo, o de un trabajador con el
   *   grupo en que se le dio): ese código.
   * - Alimentación de un trabajador sin code_group (registros antiguos de un
   *   trabajador en varios grupos): su id_group en Operation_Worker de esa
   *   operación traducido a OperationGroup.code (varios se unen con ", ").
   */
  async exportFeedingsExcel(
    filters: FilterWorkerFeedingDto,
  ): Promise<{ buffer: Buffer; fileName: string } | { noContent: true }> {
    const feedings = await this.prisma.workerFeeding.findMany({
      where: this.paginationService.buildWorkerFeedingWhereClause(filters),
      orderBy: { dateFeeding: 'desc' },
      include: {
        worker: { select: { name: true, payroll_code: true } },
        user: { select: { name: true } },
        operation: {
          select: {
            id: true,
            dateStart: true,
            timeStrat: true,
            dateEnd: true,
            timeEnd: true,
            op_duration: true,
            motorShip: true,
            client: { select: { name: true } },
            task: { select: { name: true } },
            jobArea: { select: { name: true } },
          },
        },
      },
    });

    if (feedings.length === 0) {
      return { noContent: true };
    }

    const operationIds = [...new Set(feedings.map((f) => f.id_operation))];
    const [assignments, groups] = await Promise.all([
      this.prisma.operation_Worker.findMany({
        where: { id_operation: { in: operationIds } },
        select: {
          id_operation: true,
          id_worker: true,
          id_group: true,
          SubTask: { select: { code: true, name: true } },
        },
      }),
      this.prisma.operationGroup.findMany({
        where: { id_operation: { in: operationIds } },
        select: { id_operation: true, id_group: true, code: true },
      }),
    ]);

    const codeByGroup = new Map(
      groups.map((g) => [`${g.id_operation}-${g.id_group}`, g.code]),
    );
    const groupByCode = new Map(
      groups.map((g) => [`${g.id_operation}-${g.code}`, g.id_group]),
    );
    // Grupos y subservicio de cada trabajador por operación, y subservicio por grupo
    const groupCodesByWorker = new Map<string, Set<string>>();
    const subTaskByWorker = new Map<string, { code: string; name: string }>();
    const subTaskByGroup = new Map<string, { code: string; name: string }>();
    for (const a of assignments) {
      const workerKey = `${a.id_operation}-${a.id_worker}`;
      const groupKey = `${a.id_operation}-${a.id_group}`;
      const code = a.id_group ? codeByGroup.get(groupKey) : undefined;
      if (code) {
        if (!groupCodesByWorker.has(workerKey)) groupCodesByWorker.set(workerKey, new Set());
        groupCodesByWorker.get(workerKey)!.add(code);
      }
      if (a.SubTask) {
        if (!subTaskByWorker.has(workerKey)) subTaskByWorker.set(workerKey, a.SubTask);
        if (a.id_group && !subTaskByGroup.has(groupKey)) subTaskByGroup.set(groupKey, a.SubTask);
      }
    }

    const toNumberIfNumeric = (value: string) =>
      /^\d+$/.test(value) ? Number(value) : value;

    const headers = [
      'Código Nómina',
      'Trabajador',
      'Operación',
      'Grupo',
      'Área',
      'Fecha Inicio',
      'Hora Inicio',
      'Fecha Fin',
      'Hora Fin',
      'Código Subservicio',
      'Subservicio',
      'Q Horas',
      'Cliente',
      'Embarcación',
      'Tipo de Alimentación',
      'Fecha Alimentación',
      'Semana',
      'Hora Registro',
      'Registrado Por',
    ];

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'PlannerWeb';
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet('Alimentación', {
      pageSetup: { fitToPage: true, fitToHeight: 5, fitToWidth: 7 },
    });

    const headerRow = worksheet.addRow(headers);
    headerRow.height = 28;
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '4472C4' } };
      cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 12 };
      cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
      cell.border = {
        top: { style: 'thin' },
        left: { style: 'thin' },
        bottom: { style: 'thin' },
        right: { style: 'thin' },
      };
    });

    feedings.forEach((feeding, index) => {
      const operation = feeding.operation;
      const workerKey = `${feeding.id_operation}-${feeding.id_worker}`;

      let groupCode: number | string = '';
      let subTask: { code: string; name: string } | undefined;
      if (feeding.code_group != null) {
        // Alimentación extra del grupo (sin trabajador) o alimentación de un
        // trabajador con el grupo en que se le dio: el grupo es code_group.
        groupCode = feeding.code_group;
        const idGroup = groupByCode.get(`${feeding.id_operation}-${feeding.code_group}`);
        if (idGroup) subTask = subTaskByGroup.get(`${feeding.id_operation}-${idGroup}`);
        if (!subTask && feeding.id_worker != null) subTask = subTaskByWorker.get(workerKey);
      } else if (feeding.id_worker != null) {
        // Registros sin código de grupo (trabajador en varios grupos):
        // grupos del trabajador en esa operación.
        const codes = [...(groupCodesByWorker.get(workerKey) || [])];
        groupCode = codes.length === 1 ? toNumberIfNumeric(codes[0]) : codes.join(', ');
        subTask = subTaskByWorker.get(workerKey);
      }

      // Alimentación adherida al grupo: no tiene trabajador, así que en vez de
      // un código de nómina 0 se identifica con el texto "Alimentación".
      const isGroupFeeding = feeding.id_worker == null;
      const row = worksheet.addRow([
        feeding.worker?.payroll_code
          ? toNumberIfNumeric(feeding.worker.payroll_code)
          : isGroupFeeding
            ? 'Alimentación'
            : 0,
        feeding.worker?.name || (isGroupFeeding ? 'Alimentación de grupo' : 'N/A'),
        feeding.id_operation,
        groupCode,
        // Área de la operación donde se entregó la alimentación
        operation?.jobArea?.name || '',
        toExcelDateSerial(operation?.dateStart),
        timeStringToExcelFraction(operation?.timeStrat),
        toExcelDateSerial(operation?.dateEnd),
        timeStringToExcelFraction(operation?.timeEnd),
        subTask?.code ? toNumberIfNumeric(subTask.code) : 0,
        subTask?.name || operation?.task?.name || 'Sin subservicio',
        operation?.op_duration || 0,
        operation?.client?.name || 'Sin cliente',
        operation?.motorShip || '',
        FEEDING_TYPE_LABELS[feeding.type] || feeding.type,
        toExcelDateSerial(feeding.dateFeeding),
        getIsoWeekNumber(feeding.dateFeeding),
        getColombianTimeOfDayFraction(feeding.createAt),
        feeding.user?.name || 'N/A',
      ]);

      row.getCell(1).numFmt = '0'; // Código Nómina
      row.getCell(3).numFmt = '0'; // Operación
      row.getCell(4).numFmt = '0'; // Grupo
      // 5: Área (texto)
      row.getCell(6).numFmt = 'dd/mm/yyyy'; // Fecha Inicio
      row.getCell(7).numFmt = 'hh:mm'; // Hora Inicio
      row.getCell(8).numFmt = 'dd/mm/yyyy'; // Fecha Fin
      row.getCell(9).numFmt = 'hh:mm'; // Hora Fin
      row.getCell(10).numFmt = '0'; // Código Subservicio
      row.getCell(12).numFmt = '0.00'; // Q Horas
      row.getCell(16).numFmt = 'dd/mm/yyyy'; // Fecha Alimentación
      row.getCell(17).numFmt = '0'; // Semana
      row.getCell(18).numFmt = 'hh:mm'; // Hora Registro

      const isEven = index % 2 === 0;
      row.eachCell((cell) => {
        if (isEven) {
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F7FF' } };
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'E0E0E0' } },
          left: { style: 'thin', color: { argb: 'E0E0E0' } },
          bottom: { style: 'thin', color: { argb: 'E0E0E0' } },
          right: { style: 'thin', color: { argb: 'E0E0E0' } },
        };
        cell.alignment = { vertical: 'middle' };
      });
    });

    worksheet.columns.forEach((column) => {
      let maxLength = 0;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const length = cell.value ? String(cell.value).length : 10;
        if (length > maxLength) maxLength = length;
      });
      column.width = Math.min(maxLength + 4, 30);
    });

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const fileName = `registros_alimentacion_${formatColombianISODate(new Date())}.xlsx`;
    return { buffer, fileName };
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

    // Grupo desde el que se registra (Operation_Worker.id_group): debe ser un
    // grupo de ESTA operación. Se guarda como code_group (OperationGroup.code)
    // y solo para los trabajadores que están en ese grupo.
    let workersInGroup = new Set<number>();
    let groupCode: number | null = null;
    if (dto.id_group) {
      const [groupAssignments, operationGroup] = await Promise.all([
        this.prisma.operation_Worker.findMany({
          where: { id_operation: dto.id_operation, id_group: dto.id_group },
          select: { id_worker: true },
        }),
        this.prisma.operationGroup.findUnique({
          where: {
            id_operation_id_group: { id_operation: dto.id_operation, id_group: dto.id_group },
          },
          select: { code: true },
        }),
      ]);
      const code = operationGroup ? Number(operationGroup.code) : NaN;
      if (groupAssignments.length === 0 || !Number.isSafeInteger(code)) {
        return {
          status: 404,
          message: `El grupo ${dto.id_group} no pertenece a la operación ${dto.id_operation}`,
        };
      }
      workersInGroup = new Set(groupAssignments.map((a) => a.id_worker));
      groupCode = code;
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
      code_group?: number | null;
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
        code_group: groupCode != null && workersInGroup.has(item.id_worker) ? groupCode : null,
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
