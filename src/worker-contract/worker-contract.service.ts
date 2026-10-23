import { Injectable } from '@nestjs/common';
import { Prisma, StatusActivation } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateWorkerContractDto } from './dto/create-worker-contract.dto';
import { UpdateWorkerContractDto } from './dto/update-worker-contract.dto';

type Db = Prisma.TransactionClient;
type ServiceError = { status: number; message: string };

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

const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** 'YYYY-MM-DD' -> Date a medianoche UTC (columnas @db.Date) */
const toDate = (value: string) => new Date(`${value}T00:00:00.000Z`);
const dateKey = (date: Date) => date.toISOString().slice(0, 10);
/** Fecha de hoy en Colombia, a medianoche UTC */
const todayColombia = () =>
  toDate(new Date(Date.now() - COLOMBIA_OFFSET_MS).toISOString().slice(0, 10));

@Injectable()
export class WorkerContractService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Bloquea la tabla durante la transacción: las validaciones de solape se
   * hacen ANTES del INSERT (un INSERT fallido consumiría un id) y dos
   * registros simultáneos no deben pasar ambos la validación.
   */
  private lockTable(tx: Db) {
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

  /** Otro contrato del trabajador que se cruza con [start, end] */
  private findOverlap(tx: Db, id_worker: number, start: Date | null, end: Date, excludeId?: number) {
    return tx.workerContract.findFirst({
      where: {
        id_worker,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
        endDate: { gte: start ?? new Date(0) },
        OR: [{ startDate: null }, { startDate: { lte: end } }],
      },
    });
  }

  private overlapError(overlap: { id: number; startDate: Date | null; endDate: Date | null }): ServiceError {
    const from = overlap.startDate ? dateKey(overlap.startDate) : 'unknown';
    const to = overlap.endDate ? dateKey(overlap.endDate) : 'unknown';
    return {
      status: 409,
      message: `Worker already has contract ${overlap.id} from ${from} to ${to}. Close it (set its endDate) before registering a contract in that period`,
    };
  }

  /**
   * dateRetierment del trabajador = fecha de terminación de su último contrato
   */
  async syncRetirementDate(tx: Db, id_worker: number) {
    const latest = await tx.workerContract.findFirst({
      where: { id_worker, endDate: { not: null } },
      orderBy: { endDate: 'desc' },
    });
    if (latest?.endDate) {
      await tx.worker.update({
        where: { id: id_worker },
        data: { dateRetierment: latest.endDate },
      });
    }
  }

  /**
   * Al reactivar un trabajador DEACTIVATED que no tiene ningún contrato, se
   * conserva su retiro anterior como contrato histórico (legacy) con la fecha
   * de dateRetierment y los demás datos vacíos.
   */
  async archiveRetirementIfNoHistory(
    tx: Db,
    worker: { id: number; dateRetierment: Date | null },
    id_user: number,
  ) {
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
    const date = toDate(dateKey(retirement));
    const contracts = await tx.workerContract.count({ where: { id_worker, isLegacy: false } });
    if (contracts === 0) return null;

    const target = await tx.workerContract.findFirst({
      where: { id_worker, isLegacy: false, startDate: { lte: date } },
      orderBy: { startDate: 'desc' },
    });
    if (!target) {
      return {
        status: 409,
        message: `dateRetierment ${dateKey(date)} is before the start of every contract of the worker`,
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
          select: { id: true, status: true, id_site: true, code: true, payroll_code: true, dateRetierment: true },
        });
        if (!worker) {
          return { status: 404, message: `Worker with id ${dto.id_worker} not found` };
        }
        if (!this.canAccessSite(worker.id_site, siteId, role)) {
          return { status: 403, message: 'Not authorized to manage contracts of workers from another site' };
        }

        const companyError = await this.validateCompany(tx, dto.id_company);
        if (companyError) return companyError;

        const start = toDate(dto.startDate);
        const end = toDate(dto.endDate);
        if (start > end) {
          return { status: 400, message: 'startDate must be before or equal to endDate' };
        }

        const overlap = await this.findOverlap(tx, worker.id, start, end);
        if (overlap) return this.overlapError(overlap);

        const reactivate = worker.status === 'DEACTIVATED';
        if (reactivate) {
          if (worker.dateRetierment && dateKey(worker.dateRetierment) >= dto.startDate) {
            return {
              status: 409,
              message: `startDate must be after the worker retirement date (${dateKey(worker.dateRetierment)})`,
            };
          }
          // Mismas reglas que la reactivación desde PATCH /worker
          if (worker.code) {
            const codeInUse = await tx.worker.findFirst({
              where: { code: worker.code, id: { not: worker.id }, status: { not: 'DEACTIVATED' } },
            });
            if (codeInUse) {
              return {
                status: 409,
                message: `Cannot activate worker. Code ${worker.code} is already in use by another active worker. Please assign a new code first.`,
              };
            }
          }
          if (worker.payroll_code) {
            const payrollInUse = await tx.worker.findFirst({
              where: { payroll_code: worker.payroll_code, id: { not: worker.id } },
            });
            if (payrollInUse) {
              return {
                status: 409,
                message: `Cannot activate worker. Payroll code ${worker.payroll_code} is already in use by another worker.`,
              };
            }
          }
          await this.archiveRetirementIfNoHistory(tx, worker, dto.id_user);
        }

        const contract = await tx.workerContract.create({
          data: {
            id_worker: worker.id,
            id_company: dto.id_company,
            startDate: start,
            endDate: end,
            workerType: dto.workerType,
            id_user: dto.id_user,
          },
          include: CONTRACT_INCLUDE,
        });

        if (reactivate) {
          await tx.worker.update({
            where: { id: worker.id },
            data: { status: 'AVALIABLE', createAt: new Date() },
          });
        }
        await this.syncRetirementDate(tx, worker.id);
        return contract;
      });
    } catch (error) {
      throw new Error(`Error creating worker contract: ${error}`);
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
        orderBy: [{ endDate: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
      });
    } catch (error) {
      throw new Error(`Error fetching contracts of worker ${id_worker}: ${error}`);
    }
  }

  /** Contrato vigente en una fecha (por defecto hoy en Colombia) */
  async findCurrent(id_worker: number, siteId?: number, role?: string, date?: string) {
    const list = await this.findByWorker(id_worker, siteId, role);
    if (!Array.isArray(list)) return list;
    const day = date ? toDate(date) : todayColombia();
    const current = list.find(
      (c) => !c.isLegacy && c.startDate && c.endDate && c.startDate <= day && day <= c.endDate,
    );
    if (!current) {
      return { status: 404, message: `Worker ${id_worker} has no contract in effect on ${dateKey(day)}` };
    }
    return current;
  }

  async findOne(id: number, siteId?: number, role?: string) {
    try {
      const contract = await this.prisma.workerContract.findUnique({
        where: { id },
        include: { ...CONTRACT_INCLUDE, worker: { select: { id_site: true } } },
      });
      if (!contract || !this.canAccessSite(contract.worker.id_site, siteId, role)) {
        return { status: 404, message: `Worker contract with id ${id} not found` };
      }
      const { worker, ...rest } = contract;
      return rest;
    } catch (error) {
      throw new Error(`Error fetching worker contract with id ${id}: ${error}`);
    }
  }

  /**
   * Contratos que vencen dentro de `days` días (o ya vencieron) cuyo
   * trabajador sigue activo y no tiene un contrato posterior. Solo alerta:
   * desactivar al trabajador lo hace el usuario.
   */
  async findExpiring(days: number, siteId?: number, role?: string) {
    try {
      const today = todayColombia();
      const limit = new Date(today.getTime() + days * DAY_MS);
      const candidates = await this.prisma.workerContract.findMany({
        where: {
          isLegacy: false,
          endDate: { lte: limit },
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

      const later = await this.prisma.workerContract.findMany({
        where: { id_worker: { in: candidates.map((c) => c.id_worker) }, isLegacy: false },
        select: { id_worker: true, startDate: true },
      });
      return candidates
        .filter(
          (c) => !later.some((o) => o.id_worker === c.id_worker && o.startDate && c.endDate && o.startDate > c.endDate),
        )
        .map((c) => ({
          ...c,
          daysLeft: Math.round((c.endDate!.getTime() - today.getTime()) / DAY_MS),
        }));
    } catch (error) {
      throw new Error(`Error fetching expiring contracts: ${error}`);
    }
  }

  async update(id: number, dto: UpdateWorkerContractDto, siteId?: number, role?: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockTable(tx);

        const contract = await tx.workerContract.findUnique({
          where: { id },
          include: { worker: { select: { id_site: true } } },
        });
        if (!contract || !this.canAccessSite(contract.worker.id_site, siteId, role)) {
          return { status: 404, message: `Worker contract with id ${id} not found` };
        }

        if (dto.id_company !== undefined) {
          const companyError = await this.validateCompany(tx, dto.id_company);
          if (companyError) return companyError;
        }

        const start = dto.startDate ? toDate(dto.startDate) : contract.startDate;
        const end = dto.endDate ? toDate(dto.endDate) : contract.endDate;
        if (start && end && start > end) {
          return { status: 400, message: 'startDate must be before or equal to endDate' };
        }
        if (end) {
          const overlap = await this.findOverlap(tx, contract.id_worker, start, end, id);
          if (overlap) return this.overlapError(overlap);
        }

        const updated = await tx.workerContract.update({
          where: { id },
          data: {
            id_company: dto.id_company,
            startDate: dto.startDate ? start : undefined,
            endDate: dto.endDate ? end : undefined,
            workerType: dto.workerType,
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

  async remove(id: number, siteId?: number, role?: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const contract = await tx.workerContract.findUnique({
          where: { id },
          include: { worker: { select: { id_site: true } } },
        });
        if (!contract || !this.canAccessSite(contract.worker.id_site, siteId, role)) {
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
