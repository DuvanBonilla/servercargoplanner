import { Injectable } from '@nestjs/common';
import { InabilityRecoveryStatus, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  formatColombianISODate,
  getColombianToday,
  toColombianDateOnly,
} from 'src/common/utils/dateColombia';
import { CreateInabilityFollowUpDto } from '../dto/inability-tracking.dto';
import { deadlines } from '../inability-rules';
import { CertificateStorageService } from './certificate-storage.service';
import type { UploadedCertificate } from './certificate-extraction.service';

type ServiceError = { status: number; message: string };

const isoOrNull = (date?: Date | null) => (date ? formatColombianISODate(date) : null);
const numberOrNull = (value?: Prisma.Decimal | null) => (value === null || value === undefined ? null : Number(value));
/** Con estos estados ya no hay nada por radicar ni recobrar */
const CLOSED: InabilityRecoveryStatus[] = ['PAID', 'NOT_APPLICABLE'];

const FOLLOW_UP_SELECT = {
  id: true,
  type: true,
  eventDate: true,
  recoveryStatus: true,
  filingNumber: true,
  nail: true,
  pqrNumber: true,
  amount: true,
  days: true,
  description: true,
  createAt: true,
  user: { select: { name: true } },
} satisfies Prisma.InabilityFollowUpSelect;

const INCLUDE = {
  worker: { select: { id: true, name: true, dni: true, payroll_code: true, id_site: true } },
  company: { select: { id: true, name: true } },
  eps: { select: { id: true, name: true } },
  arl: { select: { id: true, name: true } },
  user: { select: { name: true } },
  followUps: { select: FOLLOW_UP_SELECT, orderBy: [{ eventDate: 'desc' }, { id: 'desc' }] },
} satisfies Prisma.InabilityInclude;

type Row = Prisma.InabilityGetPayload<{ include: typeof INCLUDE; omit: { extractedData: true } }>;

/** Estado inicial del recobro: si la empresa asume todos los días no hay nada que recobrar */
export function initialRecoveryStatus(row: {
  companyDays: number | null;
  entityDays: number | null;
  pensionFundDays: number | null;
}): InabilityRecoveryStatus {
  return row.companyDays !== null && !row.entityDays && !row.pensionFundDays ? 'NOT_APPLICABLE' : 'PENDING';
}

/** Días que debe pagar la EPS/ARL (o el fondo de pensiones); null si la incapacidad no tiene cálculo */
export function owedDays(row: { entityDays: number | null; pensionFundDays: number | null }) {
  return row.entityDays === null ? null : row.entityDays + (row.pensionFundDays ?? 0);
}

/**
 * Pagada cuando lo pagado cubre todos los días que debe la entidad y, si se
 * conoce el valor aprobado en su liquidación, también ese valor; si no, parcial.
 */
export function paymentStatus(paidDays: number, paidAmount: number, owed: number | null, approvedAmount: number | null): InabilityRecoveryStatus {
  const daysCovered = owed !== null && paidDays >= owed;
  const amountCovered = approvedAmount === null || paidAmount >= approvedAmount;
  return daysCovered && amountCovered ? 'PAID' : 'PARTIALLY_PAID';
}

/**
 * Seguimiento de las incapacidades: listado con el estado del recobro, historial
 * de radicaciones, PQR, pagos y rechazos, y certificado de cada una.
 */
@Injectable()
export class InabilityTrackingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CertificateStorageService,
  ) {}

  private toRow(row: Row, today: Date) {
    const { followUps, documentPath, ...data } = row;
    const events = followUps.filter((f) => f.type !== 'DATA_CHANGE');
    const payments = events.filter((f) => f.type === 'PAYMENT');
    const paidAmount = payments.reduce((total, f) => total + Number(f.amount ?? 0), 0);
    const paidDays = payments.reduce((total, f) => total + (f.days ?? 0), 0);
    const approvedAmount = numberOrNull(row.approvedAmount);
    const recoveryDeadline = deadlines(row.dateDisableStart, row.ipsInNetwork).recoveryDeadline;
    const open = !CLOSED.includes(row.recoveryStatus);
    return {
      ...data,
      dateDisableStart: isoOrNull(row.dateDisableStart),
      dateDisableEnd: isoOrNull(row.dateDisableEnd),
      issueDate: isoOrNull(row.issueDate),
      externalChainStart: isoOrNull(row.externalChainStart),
      filingDeadline: isoOrNull(row.filingDeadline),
      recoveryDeadline: isoOrNull(recoveryDeadline),
      approvedAmount,
      hasCertificate: !!documentPath,
      // El radicado cambia si se rechaza y se vuelve a radicar: vale el último
      currentFilingNumber: events.find((f) => f.filingNumber)?.filingNumber ?? row.entityFilingNumber,
      currentNail: events.find((f) => f.nail)?.nail ?? row.nail,
      lastPqrNumber: events.find((f) => f.pqrNumber)?.pqrNumber ?? null,
      paidAmount,
      paidDays,
      owedDays: owedDays(row),
      pendingAmount: approvedAmount === null ? null : Math.max(approvedAmount - paidAmount, 0),
      lastEventDate: isoOrNull(events[0]?.eventDate),
      filingOverdue: row.recoveryStatus === 'PENDING' && !!row.filingDeadline && row.filingDeadline < today,
      recoveryOverdue: open && recoveryDeadline < today,
      followUps: followUps.map((f) => ({ ...f, eventDate: isoOrNull(f.eventDate), amount: numberOrNull(f.amount) })),
    };
  }

  async list(siteId?: number, subsiteId?: number | null) {
    if (!siteId) return { status: 404, message: 'Site not found or not assigned to user' } as ServiceError;
    const rows = await this.prisma.inability.findMany({
      where: { worker: { id_site: siteId, ...(subsiteId ? { id_subsite: subsiteId } : {}) } },
      include: INCLUDE,
      omit: { extractedData: true },
      orderBy: [{ dateDisableStart: 'desc' }, { id: 'desc' }],
    });
    const today = getColombianToday();
    return rows.map((row) => this.toRow(row, today));
  }

  /** La incapacidad si existe y es de la sede del usuario */
  private async findAccessible(id: number, siteId?: number, role?: string) {
    const row = await this.prisma.inability.findUnique({
      where: { id },
      select: {
        id: true,
        dateDisableStart: true,
        documentPath: true,
        recoveryStatus: true,
        approvedAmount: true,
        companyDays: true,
        entityDays: true,
        pensionFundDays: true,
        worker: { select: { id_site: true } },
      },
    });
    if (!row || (role !== 'SUPERADMIN' && siteId !== undefined && row.worker.id_site !== siteId)) {
      return { status: 404, message: `Inability with id ${id} not found` } as ServiceError;
    }
    return row;
  }

  async findOne(id: number, siteId?: number, role?: string) {
    const access = await this.findAccessible(id, siteId, role);
    if ('message' in access) return access;
    const row = await this.prisma.inability.findUniqueOrThrow({
      where: { id },
      include: INCLUDE,
      omit: { extractedData: true },
    });
    return this.toRow(row, getColombianToday());
  }

  /** Estado que deja el evento, o el error de lo que le falta según su tipo */
  private resolveEvent(dto: CreateInabilityFollowUpDto, current: InabilityRecoveryStatus): InabilityRecoveryStatus | ServiceError {
    switch (dto.type) {
      case 'FILING':
        if (!dto.filingNumber) return { status: 400, message: 'filingNumber is required for a FILING' };
        return 'FILED';
      case 'PQR':
        if (!dto.pqrNumber && !dto.description) return { status: 400, message: 'pqrNumber or description is required for a PQR' };
        return 'IN_RECOVERY';
      case 'PAYMENT':
        // Lo calcula addFollowUp con los días que debe la entidad
        if (!dto.amount) return { status: 400, message: 'amount is required for a PAYMENT' };
        if (!dto.days) return { status: 400, message: 'days is required for a PAYMENT' };
        return 'PARTIALLY_PAID';
      case 'REJECTION':
        if (!dto.description) return { status: 400, message: 'description is required for a REJECTION' };
        return 'REJECTED';
      default:
        if (!dto.description) return { status: 400, message: 'description is required for a NOTE' };
        return dto.recoveryStatus ?? current;
    }
  }

  async addFollowUp(id: number, dto: CreateInabilityFollowUpDto, id_user: number, siteId?: number, role?: string) {
    const row = await this.findAccessible(id, siteId, role);
    if ('message' in row) return row;

    const eventDate = toColombianDateOnly(dto.eventDate);
    if (eventDate > getColombianToday()) return { status: 400, message: 'eventDate cannot be in the future' } as ServiceError;
    if (eventDate < row.dateDisableStart) {
      return { status: 400, message: 'eventDate cannot be before the start of the inability' } as ServiceError;
    }
    let recoveryStatus = this.resolveEvent(dto, row.recoveryStatus);
    if (typeof recoveryStatus !== 'string') return recoveryStatus;
    if (dto.type === 'PAYMENT') {
      const owed = owedDays(row);
      if (owed === null) {
        return {
          status: 400,
          message: 'Complete the inability data before registering payments: the days owed by the entity are unknown',
        } as ServiceError;
      }
      const paid = await this.prisma.inabilityFollowUp.aggregate({
        where: { id_inability: id, type: 'PAYMENT' },
        _sum: { days: true, amount: true },
      });
      recoveryStatus = paymentStatus(
        (paid._sum.days ?? 0) + dto.days!,
        Number(paid._sum.amount ?? 0) + dto.amount!,
        owed,
        numberOrNull(row.approvedAmount),
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Inability" WHERE id = ${id} FOR UPDATE`;
      await tx.inabilityFollowUp.create({
        data: {
          id_inability: id,
          type: dto.type,
          eventDate,
          recoveryStatus,
          filingNumber: dto.type === 'FILING' ? dto.filingNumber : null,
          nail: dto.nail ?? null,
          pqrNumber: dto.type === 'PQR' ? (dto.pqrNumber ?? null) : null,
          amount: dto.type === 'PAYMENT' ? dto.amount : null,
          days: dto.type === 'PAYMENT' ? (dto.days ?? null) : null,
          description: dto.description ?? null,
          id_user,
        },
      });
      await tx.inability.update({ where: { id }, data: { recoveryStatus } });
    });
    return this.findOne(id, siteId, role);
  }

  /**
   * Corrige un error de digitación: solo se elimina el último evento, el estado
   * vuelve al del evento anterior y queda constancia en el historial.
   */
  async removeFollowUp(id: number, followUpId: number, id_user: number, siteId?: number, role?: string) {
    const row = await this.findAccessible(id, siteId, role);
    if ('message' in row) return row;

    const events = await this.prisma.inabilityFollowUp.findMany({
      where: { id_inability: id, type: { not: 'DATA_CHANGE' } },
      orderBy: [{ eventDate: 'desc' }, { id: 'desc' }],
    });
    const target = events.find((e) => e.id === followUpId);
    if (!target) return { status: 404, message: `Follow-up with id ${followUpId} not found` } as ServiceError;
    if (events[0].id !== followUpId) return { status: 409, message: 'Only the latest follow-up can be deleted' } as ServiceError;

    const recoveryStatus = events[1]?.recoveryStatus ?? initialRecoveryStatus(row);
    const detail = [target.type, formatColombianISODate(target.eventDate), target.filingNumber, target.pqrNumber, target.amount?.toString()]
      .filter(Boolean)
      .join(' ');
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Inability" WHERE id = ${id} FOR UPDATE`;
      await tx.inabilityFollowUp.delete({ where: { id: followUpId } });
      await tx.inability.update({ where: { id }, data: { recoveryStatus } });
      await tx.inabilityFollowUp.create({
        data: {
          id_inability: id,
          type: 'DATA_CHANGE',
          eventDate: getColombianToday(),
          recoveryStatus,
          description: `deleted:${detail}`,
          id_user,
        },
      });
    });
    return this.findOne(id, siteId, role);
  }

  /** Carga o reemplaza el certificado (incapacidades antiguas o archivo equivocado), sin IA */
  async replaceCertificate(id: number, file: UploadedCertificate, id_user: number, siteId?: number, role?: string) {
    const row = await this.findAccessible(id, siteId, role);
    if ('message' in row) return row;
    if (!this.storage.isAllowedType(file.mimetype)) {
      return { status: 415, message: `Certificate could not be extracted: unsupported file type ${file.mimetype}` } as ServiceError;
    }

    const documentPath = await this.storage.saveFinal(file, row.dateDisableStart.getUTCFullYear());
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.inability.update({
          where: { id },
          data: { documentPath, documentName: file.originalname, documentCheck: 'CONFIRMED' },
        });
        await tx.inabilityFollowUp.create({
          data: {
            id_inability: id,
            type: 'DATA_CHANGE',
            eventDate: getColombianToday(),
            recoveryStatus: row.recoveryStatus,
            description: 'fields:certificate',
            id_user,
          },
        });
      });
    } catch (error) {
      await this.storage.remove(documentPath);
      throw new Error(`Error storing certificate of inability ${id}: ${error}`);
    }
    if (row.documentPath) await this.storage.remove(row.documentPath);
    return this.findOne(id, siteId, role);
  }
}
