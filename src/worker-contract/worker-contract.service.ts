import { Injectable } from '@nestjs/common';
import { ContractType, Prisma, StatusActivation, WorkerType } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  addColombianDays,
  formatColombianISODate,
  getColombianToday,
  getDaysBetween,
  toColombianDateOnly,
} from 'src/common/utils/dateColombia';
import {
  CONTRACT_RULES,
  calculateEndDate,
  maxEndDate,
  minEndDate,
  RELOCATION_TYPES,
  STIPULATED_END_TYPES,
  stipulatedEndDate,
} from './contract-rules';
import { CreateWorkerContractDto } from './dto/create-worker-contract.dto';
import { UpdateWorkerContractDto } from './dto/update-worker-contract.dto';
import { RenewWorkerContractDto } from './dto/renew-worker-contract.dto';

type Db = Prisma.TransactionClient;
type ServiceError = { status: number; message: string };

/** Datos de un contrato antes de validarlo */
export interface ContractInput {
  id_company: number;
  startDate: string;
  endDate?: string | null;
  workerType: WorkerType;
  contractType: ContractType;
  /** Duración del aprendizaje en meses (6 a 12) cuando no se envía endDate */
  months?: number;
  /** Trabajador reubicado: contrato vigente sin fecha de terminación */
  isRelocated?: boolean;
}

/** Contrato ya validado, listo para guardarse */
export interface PreparedContract {
  id_company: number;
  startDate: Date;
  endDate: Date | null;
  workerType: WorkerType;
  contractType: ContractType;
  isRelocated: boolean;
}

/** Estado del trabajador que condiciona qué contratos se le pueden registrar */
interface WorkerState {
  id?: number;
  status: string;
  dateRetierment: Date | null;
}

const CONTRACT_INCLUDE = {
  company: {
    select: {
      id: true,
      name: true,
      nit: true,
      arl: { select: { id: true, name: true } },
    },
  },
} satisfies Prisma.WorkerContractInclude;

const fmt = (date: Date | null) => (date ? formatColombianISODate(date) : 'indefinite');
const isError = (value: any): value is ServiceError =>
  value && typeof value.status === 'number' && typeof value.message === 'string';

@Injectable()
export class WorkerContractService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bloquea la tabla durante la transacción: las validaciones de solape se
   * hacen ANTES del INSERT (un INSERT fallido consumiría un id) y dos
   * registros simultáneos no deben pasar ambos la validación.
   */
  lockTable(tx: Db) {
    return tx.$executeRaw`LOCK TABLE "WorkerContract" IN SHARE ROW EXCLUSIVE MODE`;
  }

  private canAccessSite(workerSite: number, siteId?: number, role?: string) {
    return role === 'SUPERADMIN' || siteId === undefined || workerSite === siteId;
  }

  private async validateCompany(tx: Db, id_company: number): Promise<ServiceError | null> {
    const company = await tx.company.findUnique({ where: { id: id_company } });
    if (!company) {
      return { status: 404, message: `Company with id ${id_company} not found` };
    }
    if (company.status !== StatusActivation.ACTIVE) {
      return { status: 400, message: `Company with id ${id_company} is not ACTIVE` };
    }
    return null;
  }

  /**
   * Otro contrato del trabajador que se cruza con [start, end]. Un contrato
   * indefinido sin terminación (end null) se toma como abierto hacia adelante.
   */
  private findOverlap(tx: Db, id_worker: number, start: Date | null, end: Date | null, excludeId?: number) {
    return tx.workerContract.findFirst({
      where: {
        id_worker,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
        AND: [
          { OR: [{ endDate: { gte: start ?? new Date(0) } }, { endDate: null, isLegacy: false }] },
          end ? { OR: [{ startDate: null }, { startDate: { lte: end } }] } : {},
        ],
      },
    });
  }

  private overlapError(overlap: { id: number; startDate: Date | null; endDate: Date | null }): ServiceError {
    const from = overlap.startDate ? formatColombianISODate(overlap.startDate) : 'unknown';
    return {
      status: 409,
      message: `Worker already has contract ${overlap.id} from ${from} to ${fmt(overlap.endDate)}. Close it (set its endDate) before registering a contract in that period`,
    };
  }

  /**
   * A un trabajador DEACTIVATED solo se le registran contratos históricos:
   * ya terminados (antes de hoy) y no posteriores a su fecha de retiro.
   * Registrar un contrato nunca reactiva al trabajador.
   */
  private validateDeactivatedHistory(worker: WorkerState, end: Date | null): ServiceError | null {
    if (worker.status !== 'DEACTIVATED') return null;
    if (!end || end >= getColombianToday()) {
      return {
        status: 409,
        message: 'Worker is DEACTIVATED: only finished contracts (endDate before today) can be registered. Reactivate the worker to register a current contract',
      };
    }
    if (worker.dateRetierment && end > toColombianDateOnly(worker.dateRetierment)) {
      return {
        status: 409,
        message: `Worker is DEACTIVATED: contract endDate cannot be after the retirement date (${formatColombianISODate(worker.dateRetierment)})`,
      };
    }
    return null;
  }

  /**
   * Fecha de terminación calculada y límites de una modalidad. La terminación
   * es N días antes del vencimiento estipulado para que el contrato no se
   * renueve automáticamente. En obra labor el vencimiento lo indica el usuario
   * (`stipulatedEndDate`).
   */
  getEndDateSuggestion(contractType: ContractType, startDate: string, months?: number, stipulatedEnd?: string) {
    if (months !== undefined && contractType !== 'APPRENTICESHIP') {
      return { status: 400, message: 'months only applies to APPRENTICESHIP contracts' };
    }
    if (months !== undefined && (months < 6 || months > 12)) {
      return { status: 400, message: 'months must be between 6 and 12 for APPRENTICESHIP contracts' };
    }
    if (stipulatedEnd !== undefined && !STIPULATED_END_TYPES.includes(contractType)) {
      return { status: 400, message: 'stipulatedEndDate only applies to OBRA_LABOR contracts' };
    }
    const start = toColombianDateOnly(startDate);
    const stipulatedInput = stipulatedEnd ? toColombianDateOnly(stipulatedEnd) : undefined;
    if (stipulatedInput && stipulatedInput < start) {
      return { status: 400, message: 'stipulatedEndDate must be after startDate' };
    }
    const stipulated = stipulatedEndDate(contractType, start, { months, stipulatedEnd: stipulatedInput });
    const suggested = calculateEndDate(contractType, start, { months, stipulatedEnd: stipulatedInput });
    const min = minEndDate(contractType, start);
    const max = maxEndDate(contractType, start);
    if (suggested && max && suggested > max) {
      return {
        status: 400,
        message: `endDate exceeds the maximum duration of a ${contractType} contract (${formatColombianISODate(max)})`,
      };
    }
    if (suggested && min && suggested < min) {
      return {
        status: 400,
        message: `endDate is shorter than the minimum duration of a ${contractType} contract (${formatColombianISODate(min)})`,
      };
    }
    return {
      contractType,
      startDate,
      stipulatedEndDate: stipulated ? formatColombianISODate(stipulated) : null,
      suggestedEndDate: suggested ? formatColombianISODate(suggested) : null,
      terminationDaysBefore: CONTRACT_RULES[contractType].terminationDaysBefore,
      minEndDate: min ? formatColombianISODate(min) : null,
      maxEndDate: max ? formatColombianISODate(max) : null,
      endDateRequired: contractType !== 'INDEFINITE',
    };
  }

  /**
   * Valida un contrato nuevo (empresa, fechas según la modalidad, estado del
   * trabajador y cruces) sin escribir nada. Si no llega endDate se usa la
   * fecha calculada para la modalidad.
   */
  async prepare(tx: Db, input: ContractInput, worker: WorkerState): Promise<PreparedContract | ServiceError> {
    const companyError = await this.validateCompany(tx, input.id_company);
    if (companyError) return companyError;

    const type = input.contractType;
    const start = toColombianDateOnly(input.startDate);
    let end: Date | null;

    if (input.isRelocated && !RELOCATION_TYPES.includes(type)) {
      return { status: 400, message: `isRelocated does not apply to ${type} contracts` };
    }

    if (input.isRelocated) {
      if (input.endDate) {
        return { status: 400, message: 'A relocated contract has no endDate when registered; set it when the contract ends' };
      }
      end = null;
    } else if (type === 'INDEFINITE') {
      if (input.endDate) {
        return { status: 400, message: 'INDEFINITE contracts have no endDate when registered; set it when the contract ends' };
      }
      end = null;
    } else {
      if (input.months !== undefined) {
        const suggestion = this.getEndDateSuggestion(type, input.startDate, input.months);
        if (isError(suggestion)) return suggestion;
      }
      end = input.endDate
        ? toColombianDateOnly(input.endDate)
        : calculateEndDate(type, start, { months: input.months });
      if (!end) {
        return { status: 400, message: `endDate is required for ${type} contracts` };
      }
      if (start > end) {
        return { status: 400, message: 'startDate must be before or equal to endDate' };
      }
      const max = maxEndDate(type, start);
      if (max && end > max) {
        return { status: 400, message: `endDate exceeds the maximum duration of a ${type} contract (${formatColombianISODate(max)})` };
      }
      const min = minEndDate(type, start);
      if (min && end < min) {
        return { status: 400, message: `endDate is shorter than the minimum duration of a ${type} contract (${formatColombianISODate(min)})` };
      }
    }

    const historyError = this.validateDeactivatedHistory(worker, end);
    if (historyError) return historyError;

    if (worker.id !== undefined) {
      const overlap = await this.findOverlap(tx, worker.id, start, end);
      if (overlap) return this.overlapError(overlap);
    }

    return {
      id_company: input.id_company,
      startDate: start,
      endDate: end,
      workerType: input.workerType,
      contractType: type,
      isRelocated: input.isRelocated ?? false,
    };
  }

  /** Guarda un contrato ya validado con prepare() y sincroniza el trabajador */
  async createPrepared(tx: Db, id_worker: number, data: PreparedContract, id_user: number) {
    const contract = await tx.workerContract.create({
      data: { ...data, id_worker, id_user },
      include: CONTRACT_INCLUDE,
    });
    await this.syncRetirementDate(tx, id_worker);
    return contract;
  }

  /**
   * dateRetierment del trabajador = fecha de terminación de su último
   * contrato (null si es indefinido). Un trabajador inactivo conserva su
   * fecha de retiro; solo se completa si no la tenía.
   */
  async syncRetirementDate(tx: Db, id_worker: number) {
    const worker = await tx.worker.findUnique({
      where: { id: id_worker },
      select: { status: true, dateRetierment: true },
    });
    if (!worker) return;

    if (worker.status === 'DEACTIVATED') {
      if (worker.dateRetierment) return;
      const latestEnded = await tx.workerContract.findFirst({
        where: { id_worker, endDate: { not: null } },
        orderBy: { endDate: 'desc' },
      });
      if (latestEnded?.endDate) {
        await tx.worker.update({ where: { id: id_worker }, data: { dateRetierment: latestEnded.endDate } });
      }
      return;
    }

    const latest = await tx.workerContract.findFirst({
      where: { id_worker, isLegacy: false },
      orderBy: { startDate: 'desc' },
    });
    if (latest) {
      await tx.worker.update({ where: { id: id_worker }, data: { dateRetierment: latest.endDate } });
    }
  }

  /**
   * Al reactivar un trabajador DEACTIVATED que no tiene ningún contrato, se
   * conserva su retiro anterior como contrato histórico (legacy) con la fecha
   * de dateRetierment y los demás datos vacíos. Sin dateRetierment no hay
   * nada que conservar y no se crea el registro (quedaría vacío).
   */
  async archiveRetirementIfNoHistory(
    tx: Db,
    worker: { id: number; dateRetierment: Date | null },
    id_user: number,
  ) {
    if (!worker.dateRetierment) return null;
    const count = await tx.workerContract.count({ where: { id_worker: worker.id } });
    if (count > 0) return null;
    return tx.workerContract.create({
      data: {
        id_worker: worker.id,
        endDate: worker.dateRetierment,
        isLegacy: true,
        id_user,
      },
    });
  }

  /**
   * Al desactivar un trabajador con una fecha de retiro, esa fecha pasa a ser
   * la terminación de su último contrato iniciado antes de ella.
   */
  async applyRetirementDate(tx: Db, id_worker: number, retirement: Date): Promise<ServiceError | null> {
    const date = toColombianDateOnly(formatColombianISODate(retirement));
    const contracts = await tx.workerContract.count({ where: { id_worker, isLegacy: false } });
    if (contracts === 0) return null;

    const target = await tx.workerContract.findFirst({
      where: { id_worker, isLegacy: false, startDate: { lte: date } },
      orderBy: { startDate: 'desc' },
    });
    if (!target) {
      return {
        status: 409,
        message: `dateRetierment ${formatColombianISODate(date)} is before the start of every contract of the worker`,
      };
    }
    await tx.workerContract.update({ where: { id: target.id }, data: { endDate: date } });
    return null;
  }

  async create(dto: CreateWorkerContractDto, siteId?: number, role?: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);

        const worker = await tx.worker.findUnique({
          where: { id: dto.id_worker },
          select: { id: true, status: true, id_site: true, dateRetierment: true },
        });
        if (!worker) {
          return { status: 404, message: `Worker with id ${dto.id_worker} not found` };
        }
        if (!this.canAccessSite(worker.id_site, siteId, role)) {
          return { status: 403, message: 'Not authorized to manage contracts of workers from another site' };
        }

        const prepared = await this.prepare(tx, dto, worker);
        if (isError(prepared)) return prepared;
        return this.createPrepared(tx, worker.id, prepared, dto.id_user);
      });
    } catch (error) {
      throw new Error(`Error creating worker contract: ${error}`);
    }
  }

  /**
   * Renovación: contrato nuevo que empieza el día siguiente a la terminación
   * del contrato renovado, con la misma empresa, tipo de trabajador y
   * modalidad. Si no llega endDate se usa la fecha calculada.
   */
  async renew(
    id_worker: number,
    contractId: number,
    dto: RenewWorkerContractDto,
    id_user: number,
    siteId?: number,
    role?: string,
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);

        const contract = await tx.workerContract.findUnique({
          where: { id: contractId },
          include: { worker: { select: { id: true, id_site: true, status: true, dateRetierment: true } } },
        });
        if (!contract || contract.id_worker !== id_worker || !this.canAccessSite(contract.worker.id_site, siteId, role)) {
          return { status: 404, message: `Worker contract with id ${contractId} not found` };
        }
        if (contract.isLegacy || !contract.endDate || !contract.contractType || !contract.id_company || !contract.workerType) {
          return { status: 409, message: 'Only complete fixed-term contracts (with endDate and contractType) can be renewed' };
        }

        const prepared = await this.prepare(
          tx,
          {
            id_company: contract.id_company,
            startDate: formatColombianISODate(addColombianDays(contract.endDate, 1)),
            endDate: dto.endDate,
            workerType: contract.workerType,
            contractType: contract.contractType,
            months: dto.months,
          },
          contract.worker,
        );
        if (isError(prepared)) return prepared;
        return this.createPrepared(tx, id_worker, prepared, id_user);
      });
    } catch (error) {
      throw new Error(`Error renewing worker contract ${contractId}: ${error}`);
    }
  }

  async findByWorker(id_worker: number, siteId?: number, role?: string) {
    try {
      const worker = await this.prisma.worker.findUnique({
        where: { id: id_worker },
        select: { id_site: true },
      });
      if (!worker) {
        return { status: 404, message: `Worker with id ${id_worker} not found` };
      }
      if (!this.canAccessSite(worker.id_site, siteId, role)) {
        return { status: 403, message: 'Not authorized to view contracts of workers from another site' };
      }
      return await this.prisma.workerContract.findMany({
        where: { id_worker },
        include: CONTRACT_INCLUDE,
        orderBy: [{ startDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      });
    } catch (error) {
      throw new Error(`Error fetching contracts of worker ${id_worker}: ${error}`);
    }
  }

  /** Contrato vigente en una fecha (por defecto hoy en Colombia) */
  async findCurrent(id_worker: number, siteId?: number, role?: string, date?: string) {
    const list = await this.findByWorker(id_worker, siteId, role);
    if (!Array.isArray(list)) return list;
    const day = date ? toColombianDateOnly(date) : getColombianToday();
    const current = list.find(
      (c) => !c.isLegacy && c.startDate && c.startDate <= day && (!c.endDate || day <= c.endDate),
    );
    if (!current) {
      return { status: 404, message: `Worker ${id_worker} has no contract in effect on ${formatColombianISODate(day)}` };
    }
    return current;
  }

  /**
   * Contratos por terminar: su trabajador sigue activo, no tienen un contrato
   * posterior y su fecha de terminación cae dentro de los próximos `days`
   * días (por defecto 30) o ya pasó. Solo informa: desactivar al trabajador
   * lo hace el usuario.
   */
  async findExpiring(days: number | undefined, siteId?: number, role?: string) {
    try {
      const today = getColombianToday();
      const horizon = days ?? 30;
      const candidates = await this.prisma.workerContract.findMany({
        where: {
          isLegacy: false,
          endDate: { not: null, lte: addColombianDays(today, horizon) },
          worker: {
            status: { not: 'DEACTIVATED' },
            ...(role === 'SUPERADMIN' || siteId === undefined ? {} : { id_site: siteId }),
          },
        },
        include: {
          ...CONTRACT_INCLUDE,
          worker: { select: { id: true, name: true, dni: true, status: true } },
        },
        orderBy: { endDate: 'asc' },
      });
      if (candidates.length === 0) return [];

      const others = await this.prisma.workerContract.findMany({
        where: { id_worker: { in: candidates.map((c) => c.id_worker) }, isLegacy: false },
        select: { id_worker: true, startDate: true },
      });
      return candidates
        .filter((c) => !others.some((o) => o.id_worker === c.id_worker && o.startDate && o.startDate > c.endDate!))
        .map((c) => ({
          ...c,
          daysLeft: getDaysBetween(today, c.endDate!),
        }));
    } catch (error) {
      throw new Error(`Error fetching expiring contracts: ${error}`);
    }
  }

  async update(id: number, dto: UpdateWorkerContractDto, siteId?: number, role?: string, id_worker?: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);

        const contract = await tx.workerContract.findUnique({
          where: { id },
          include: { worker: { select: { id_site: true, status: true, dateRetierment: true } } },
        });
        if (
          !contract ||
          (id_worker !== undefined && contract.id_worker !== id_worker) ||
          !this.canAccessSite(contract.worker.id_site, siteId, role)
        ) {
          return { status: 404, message: `Worker contract with id ${id} not found` };
        }

        if (dto.id_company !== undefined) {
          const companyError = await this.validateCompany(tx, dto.id_company);
          if (companyError) return companyError;
        }

        const type = dto.contractType ?? contract.contractType;
        const start = dto.startDate ? toColombianDateOnly(dto.startDate) : contract.startDate;
        // Al marcarlo como reubicado queda sin terminación; después se cierra indicando endDate
        const relocated = dto.isRelocated ?? contract.isRelocated;
        const becomesRelocated = relocated && !contract.isRelocated;
        if (relocated && type && !RELOCATION_TYPES.includes(type)) {
          return { status: 400, message: `isRelocated does not apply to ${type} contracts` };
        }
        const end = dto.endDate ? toColombianDateOnly(dto.endDate) : becomesRelocated ? null : contract.endDate;
        if (start && end && start > end) {
          return { status: 400, message: 'startDate must be before or equal to endDate' };
        }

        if (!contract.isLegacy && type && start) {
          if (type !== 'INDEFINITE' && !relocated && !end) {
            return { status: 400, message: `endDate is required for ${type} contracts` };
          }
          // Aprendizaje: solo GH puede extender la terminación (incluso más allá de 1 año)
          const extendsApprenticeship =
            type === 'APPRENTICESHIP' && end && (!contract.endDate || end > contract.endDate);
          if (extendsApprenticeship && role !== 'GH') {
            return { status: 403, message: 'Only GH can extend the endDate of an APPRENTICESHIP contract' };
          }
          const max = maxEndDate(type, start);
          if (type !== 'APPRENTICESHIP' && !relocated && max && end && end > max) {
            return {
              status: 400,
              message: `endDate exceeds the maximum duration of a ${type} contract (${formatColombianISODate(max)}); register a renewal instead`,
            };
          }
        }

        if (dto.endDate || becomesRelocated) {
          const historyError = this.validateDeactivatedHistory(contract.worker, end);
          if (historyError) return historyError;
        }
        const overlap = await this.findOverlap(tx, contract.id_worker, start, end, id);
        if (overlap) return this.overlapError(overlap);

        const updated = await tx.workerContract.update({
          where: { id },
          data: {
            id_company: dto.id_company,
            startDate: dto.startDate ? start : undefined,
            endDate: dto.endDate || becomesRelocated ? end : undefined,
            workerType: dto.workerType,
            contractType: dto.contractType,
            isRelocated: dto.isRelocated,
          },
          include: CONTRACT_INCLUDE,
        });
        await this.syncRetirementDate(tx, contract.id_worker);
        return updated;
      });
    } catch (error) {
      throw new Error(`Error updating worker contract with id ${id}: ${error}`);
    }
  }

  async remove(id: number, siteId?: number, role?: string, id_worker?: number) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const contract = await tx.workerContract.findUnique({
          where: { id },
          include: { worker: { select: { id_site: true } } },
        });
        if (
          !contract ||
          (id_worker !== undefined && contract.id_worker !== id_worker) ||
          !this.canAccessSite(contract.worker.id_site, siteId, role)
        ) {
          return { status: 404, message: `Worker contract with id ${id} not found` };
        }
        const deleted = await tx.workerContract.delete({ where: { id } });
        await this.syncRetirementDate(tx, contract.id_worker);
        return deleted;
      });
    } catch (error) {
      // Referenciado por incapacidades: el histórico no se puede borrar
      if (error.code === 'P2003' || String(error).includes('P2003')) {
        return {
          status: 409,
          message: 'Worker contract is referenced by inabilities and cannot be deleted',
        };
      }
      throw new Error(`Error removing worker contract with id ${id}: ${error}`);
    }
  }
}

export { isError as isContractServiceError };
