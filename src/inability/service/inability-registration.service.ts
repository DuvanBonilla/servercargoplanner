import { Injectable } from '@nestjs/common';
import { CauseDisability, Prisma, TypeDisability } from '@prisma/client';
import { PrismaService } from 'src/prisma/prisma.service';
import {
  formatColombianISODate,
  getColombianToday,
  getDaysBetween,
  toColombianDateOnly,
} from 'src/common/utils/dateColombia';
import { InabilityService } from '../inability.service';
import { PreviewInabilityDto, RegisterInabilityDto } from '../dto/register-inability.dto';
import { UpdateInabilityDetailsDto } from '../dto/inability-tracking.dto';
import {
  calculatePayment,
  chainOf,
  ChainInability,
  deadlines,
  findExtensionCandidate,
  inclusiveDays,
  MAX_EXTENSION_GAP_DAYS,
  normalizeDiagnosis,
} from '../inability-rules';
import { CertificateStorageService } from './certificate-storage.service';
import { initialRecoveryStatus, owedDays, paymentStatus } from './inability-tracking.service';

type ServiceError = { status: number; message: string; details?: Record<string, unknown> };

const docDigits = (doc?: unknown) => String(doc ?? '').replace(/\D/g, '');
const isoOrNull = (date?: Date | null) => (date ? formatColombianISODate(date) : null);
const DAYS_PER_MONTH = 30;

/**
 * Registro de incapacidades a partir del certificado leído: calcula con el
 * historial del trabajador si es INICIAL o PRÓRROGA, quién paga cada día y los
 * plazos; el usuario confirma y se guarda con la copia de contrato, empresa,
 * EPS, ARL e IBC vigentes en la fecha de inicio.
 */
@Injectable()
export class InabilityRegistrationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: CertificateStorageService,
    private readonly inabilityService: InabilityService,
  ) {}

  private async loadWorker(id_worker: number, siteId?: number, role?: string) {
    const worker = await this.prisma.worker.findUnique({
      where: { id: id_worker },
      select: { id: true, name: true, dni: true, id_site: true, status: true },
    });
    if (!worker) return { status: 404, message: `Worker with id ${id_worker} not found` } as ServiceError;
    if (role !== 'SUPERADMIN' && siteId !== undefined && worker.id_site !== siteId) {
      return { status: 403, message: 'Not authorized to register inabilities of workers from another site' } as ServiceError;
    }
    return worker;
  }

  /**
   * Contrato vigente en la fecha de inicio. Para la regla de los 28 días se
   * cuenta desde el primer contrato de la cadena de renovaciones continuas con
   * la misma empresa (la renovación inicia el día siguiente al fin del anterior).
   */
  private async contractAt(id_worker: number, start: Date) {
    const contracts = await this.prisma.workerContract.findMany({
      where: { id_worker, isLegacy: false, startDate: { not: null } },
      include: { company: { include: { arl: { select: { id: true, name: true, nit: true } } } } },
      orderBy: { startDate: 'asc' },
    });
    const current = contracts.find(
      (c) => c.startDate! <= start && (c.endDate === null || c.endDate >= start),
    );
    if (!current) return null;
    let continuousStart = current.startDate!;
    for (;;) {
      const previous = contracts.find(
        (c) =>
          c.id_company === current.id_company &&
          c.endDate !== null &&
          getDaysBetween(c.endDate, continuousStart) === 1,
      );
      if (!previous) break;
      continuousStart = previous.startDate!;
    }
    return { contract: current, continuousStart };
  }

  /** Calcula todo lo que se muestra al usuario antes de guardar */
  private async calculate(dto: PreviewInabilityDto, siteId?: number, role?: string, excludeId?: number) {
    const worker = await this.loadWorker(dto.id_worker, siteId, role);
    if ('message' in worker) return worker;

    const start = toColombianDateOnly(dto.startDate);
    const end = toColombianDateOnly(dto.endDate);
    if (end < start) return { status: 400, message: 'endDate cannot be before startDate' } as ServiceError;
    const days = inclusiveDays(start, end);
    const warnings: string[] = [];

    // Contrato, empresa y ARL vigentes en la fecha de inicio
    const contractInfo = await this.contractAt(worker.id, start);
    const contract = contractInfo?.contract ?? null;
    const contractDays = contractInfo ? getDaysBetween(contractInfo.continuousStart, start) : null;
    if (!contract) warnings.push('NO_CONTRACT: the worker has no contract on the start date; the 28-day rule cannot be applied');
    if (dto.origin === 'LABOR' && contract && !contract.company?.arl) {
      warnings.push('NO_ARL: the company of the contract has no ARL assigned');
    }

    // Historial del trabajador: superposición y cadena de prórrogas
    const history = await this.prisma.inability.findMany({
      where: { id_worker: worker.id, ...(excludeId ? { id: { not: excludeId } } : {}) },
      orderBy: { dateDisableStart: 'desc' },
      select: {
        id: true,
        dateDisableStart: true,
        dateDisableEnd: true,
        type: true,
        origin: true,
        cause: true,
        days: true,
        id_extension_of: true,
        id_company: true,
        diagnosisPrincipal: true,
        diagnosesRelated: true,
        certificateNumber: true,
        externalChainStart: true,
        externalChainDays: true,
      },
    });
    const overlaps = history.filter((i) => i.dateDisableStart <= end && i.dateDisableEnd >= start);
    if (overlaps.length) warnings.push('OVERLAP: the dates overlap another inability of the worker');
    const previous = history.filter((i) => i.dateDisableEnd < start) as ChainInability[];

    const diagnoses = [dto.diagnosisPrincipal, ...(dto.diagnosesRelated ?? [])];
    const candidate = findExtensionCandidate(previous, start, diagnoses, contract?.id_company ?? null);
    const codes = new Set(diagnoses.map(normalizeDiagnosis).filter(Boolean));
    const suggestion = {
      classification: (candidate ? 'EXTENSION' : 'INITIAL') as TypeDisability,
      reason: !codes.size
        ? 'NO_DIAGNOSIS'
        : candidate
          ? 'SAME_DIAGNOSIS_WITHIN_30_DAYS'
          : 'NO_PREVIOUS_WITH_SAME_DIAGNOSIS_WITHIN_30_DAYS',
      previous: candidate ? this.summary(candidate) : null,
      gapDays: candidate ? getDaysBetween(candidate.dateDisableEnd, start) : null,
      sharedDiagnosis: candidate
        ? [candidate.diagnosisPrincipal, ...candidate.diagnosesRelated]
            .map(normalizeDiagnosis)
            .find((c) => c !== null && codes.has(c)) ?? null
        : null,
      maxGapDays: MAX_EXTENSION_GAP_DAYS,
    };

    // Clasificación aplicada: la que confirma el usuario o la sugerida
    const classification = dto.classification ?? suggestion.classification;
    const hasExternalChain = dto.externalChainStart !== undefined || dto.externalChainDays !== undefined;
    let extensionOf: ChainInability | null = null;
    // Prórroga cuya anterior no está en el sistema: el usuario indica inicio y días acumulados
    let externalChain: { start: Date; days: number } | null = null;
    if (classification === 'EXTENSION' && hasExternalChain) {
      if (dto.id_extension_of) {
        return { status: 400, message: 'externalChainStart and externalChainDays cannot be combined with id_extension_of' } as ServiceError;
      }
      if (!dto.externalChainStart || !dto.externalChainDays) {
        return { status: 400, message: 'externalChainStart and externalChainDays must be sent together' } as ServiceError;
      }
      const rootStart = toColombianDateOnly(dto.externalChainStart);
      if (rootStart >= start) {
        return { status: 400, message: 'externalChainStart must be before startDate' } as ServiceError;
      }
      const elapsed = getDaysBetween(rootStart, start);
      if (dto.externalChainDays > elapsed) {
        return {
          status: 400,
          message: `externalChainDays (${dto.externalChainDays}) cannot exceed the ${elapsed} days between externalChainStart and startDate`,
        } as ServiceError;
      }
      externalChain = { start: rootStart, days: dto.externalChainDays };
      warnings.push('EXTERNAL_CHAIN: the previous inability is not in the system; the chain start and accumulated days were entered by the user');
    } else if (classification === 'EXTENSION') {
      const id = dto.id_extension_of ?? candidate?.id;
      if (!id) {
        return {
          status: 400,
          message: 'An EXTENSION requires id_extension_of, or externalChainStart and externalChainDays: no previous inability with the same diagnosis was found',
        } as ServiceError;
      }
      extensionOf = previous.find((i) => i.id === id) ?? null;
      if (!extensionOf) {
        return {
          status: 400,
          message: `id_extension_of ${id} must be an inability of the same worker that ends before the start date`,
        } as ServiceError;
      }
    } else if (dto.id_extension_of || hasExternalChain) {
      return { status: 400, message: 'id_extension_of and externalChain data are only allowed for an EXTENSION' } as ServiceError;
    }
    const differsFromSuggestion = externalChain
      ? !!candidate
      : classification !== suggestion.classification || (extensionOf && candidate && extensionOf.id !== candidate.id);
    if (differsFromSuggestion) {
      warnings.push('CLASSIFICATION_DIFFERS_FROM_SUGGESTION: the confirmed classification differs from the worker history');
    }

    const chain = extensionOf ? chainOf(previous, extensionOf) : [];
    // La parte de la cadena fuera del sistema se digitó en la nueva o en su primera incapacidad
    const root = chain[0];
    const outside =
      externalChain ??
      (root?.externalChainStart && root.externalChainDays
        ? { start: root.externalChainStart, days: root.externalChainDays }
        : null);
    const chainDaysBefore =
      chain.reduce((t, i) => t + inclusiveDays(i.dateDisableStart, i.dateDisableEnd), 0) + (outside?.days ?? 0);
    const chainRootStart = outside?.start ?? root?.dateDisableStart ?? null;

    const payment = calculatePayment({
      origin: dto.origin,
      startDate: start,
      days,
      classification,
      chainRootStart,
      chainDaysBefore,
      contractDays,
    });
    const { filingDeadline, recoveryDeadline } = deadlines(start, dto.ipsInNetwork);

    // IBC: nunca inferior al SMMLV del año de inicio
    const year = start.getUTCFullYear();
    const wage = await this.prisma.minimumWage.findUnique({ where: { year } });
    if (!wage) warnings.push(`MINIMUM_WAGE_NOT_CONFIGURED: there is no minimum wage for ${year}`);
    if (wage && dto.ibc !== undefined && dto.ibc < wage.value) {
      return {
        status: 400,
        message: `ibc (${dto.ibc}) cannot be lower than the minimum wage of ${year} (${wage.value})`,
      } as ServiceError;
    }

    return {
      worker: { id: worker.id, name: worker.name, dni: worker.dni },
      startDate: dto.startDate,
      endDate: dto.endDate,
      days,
      contract: contract
        ? {
            id: contract.id,
            contractType: contract.contractType,
            workerType: contract.workerType,
            startDate: isoOrNull(contract.startDate),
            endDate: isoOrNull(contract.endDate),
            continuousStartDate: isoOrNull(contractInfo!.continuousStart),
          }
        : null,
      contractDays,
      company: contract?.company ? { id: contract.company.id, name: contract.company.name, nit: contract.company.nit } : null,
      arl: contract?.company?.arl ?? null,
      suggestion,
      classification,
      extensionOf: extensionOf ? this.summary(extensionOf) : null,
      chain: {
        rootId: chain[0]?.id ?? null,
        rootStartDate: isoOrNull(chainRootStart),
        inabilities: chain.length,
        externalDays: outside?.days ?? 0,
        daysBefore: chainDaysBefore,
        totalDays: chainDaysBefore + days,
      },
      payment,
      minimumWage: wage ? { year, value: wage.value, dailyValue: wage.value / DAYS_PER_MONTH } : null,
      dailyIbc: dto.ibc !== undefined ? dto.ibc / DAYS_PER_MONTH : null,
      filingDeadline: isoOrNull(filingDeadline),
      recoveryDeadline: isoOrNull(recoveryDeadline),
      overlaps: overlaps.map((i) => this.summary(i as ChainInability)),
      history: history.slice(0, 10).map((i) => ({
        ...this.summary(i as ChainInability),
        type: i.type,
        origin: i.origin,
        cause: i.cause,
        certificateNumber: i.certificateNumber,
      })),
      warnings,
      // Datos internos para el registro (no se exponen)
      _internal: { start, end, contract, extensionOf, externalChain, wage },
    };
  }

  private summary(i: ChainInability) {
    return {
      id: i.id,
      startDate: formatColombianISODate(i.dateDisableStart),
      endDate: formatColombianISODate(i.dateDisableEnd),
      days: inclusiveDays(i.dateDisableStart, i.dateDisableEnd),
      diagnosisPrincipal: i.diagnosisPrincipal,
      diagnosesRelated: i.diagnosesRelated,
      id_extension_of: i.id_extension_of,
    };
  }

  async preview(dto: PreviewInabilityDto, siteId?: number, role?: string) {
    try {
      const result = await this.calculate(dto, siteId, role, dto.id_inability);
      if ('message' in result) return result;
      const { _internal, ...visible } = result;
      return visible;
    } catch (error) {
      throw new Error(`Error calculating inability: ${error}`);
    }
  }

  async register(dto: RegisterInabilityDto, id_user: number, siteId?: number, role?: string) {
    const pending = await this.storage.readTemp(dto.fileToken);
    if (!pending) {
      return { status: 404, message: 'Certificate upload not found or expired: read the certificate again' } as ServiceError;
    }
    if (pending.id_user !== id_user) {
      return { status: 403, message: 'The certificate was read by another user' } as ServiceError;
    }

    const result = await this.calculate(dto, siteId, role);
    if ('message' in result) return result;
    const { _internal, ...calculation } = result;
    const { start, end, contract, extensionOf, externalChain, wage } = _internal;

    // La cédula se compara con la lectura guardada en el servidor, no con datos del cliente
    const fields = pending.extraction?.fields ?? {};
    const certificateDocument = docDigits(fields.workerDocumentNumber?.value) || null;
    if (certificateDocument && certificateDocument !== docDigits(calculation.worker.dni)) {
      return {
        status: 409,
        message: 'The document number on the certificate does not match the selected worker',
        details: {
          code: 'WORKER_MISMATCH',
          certificateDocument,
          certificateName: fields.workerName?.value ?? null,
          selectedWorker: calculation.worker,
        },
      } as ServiceError;
    }
    if (!certificateDocument && !dto.documentConfirmed) {
      return {
        status: 400,
        message: 'The document number could not be read from the certificate: confirm it belongs to the worker (documentConfirmed)',
        details: { code: 'DOCUMENT_NOT_CONFIRMED' },
      } as ServiceError;
    }
    if (calculation.overlaps.length) {
      return {
        status: 409,
        message: 'The dates overlap another inability of the worker',
        details: { code: 'OVERLAP', overlaps: calculation.overlaps },
      } as ServiceError;
    }
    if (!wage) {
      return {
        status: 400,
        message: `There is no minimum wage for ${start.getUTCFullYear()}: configure it before registering`,
      } as ServiceError;
    }

    const id_eps = await this.resolveEps(dto);
    if (id_eps !== null && typeof id_eps === 'object') return id_eps;
    const id_arl = dto.origin === 'LABOR' ? (contract?.company?.arl?.id ?? null) : null;

    const certificateType = ['INITIAL', 'EXTENSION'].includes(fields.classification?.value)
      ? (fields.classification.value as TypeDisability)
      : null;
    const literal = `${fields.attentionCauseText?.value ?? ''} ${fields.contingencyText?.value ?? ''}`
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toUpperCase();
    const cause: CauseDisability =
      dto.origin === 'LABOR' ? 'LABOR' : literal.includes('TRANSITO') ? 'TRANSIT' : 'DISEASE';

    // El archivo se copia ANTES del insert: si falla, no se consume un id
    const documentPath = await this.storage.promote(dto.fileToken, pending, start.getUTCFullYear());
    const approvedTotal = Number(fields.approvedTotal?.value);
    let created: any;
    try {
      created = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`LOCK TABLE "Inability" IN SHARE ROW EXCLUSIVE MODE`;
        const conflict = await this.findConflict(tx, dto, start, end, id_eps, id_arl);
        if (conflict) return conflict;
        return tx.inability.create({
          data: {
            id_worker: dto.id_worker,
            id_user,
            dateDisableStart: start,
            dateDisableEnd: end,
            type: calculation.classification,
            cause,
            origin: dto.origin,
            certificateType,
            id_extension_of: extensionOf?.id ?? null,
            days: calculation.days,
            certificateNumber: dto.certificateNumber ?? null,
            authorizationNumber: dto.authorizationNumber ?? null,
            entityFilingNumber: dto.entityFilingNumber ?? null,
            issueDate: dto.issueDate ? toColombianDateOnly(dto.issueDate) : null,
            diagnosisPrincipal: dto.diagnosisPrincipal,
            diagnosesRelated: dto.diagnosesRelated ?? [],
            ipsName: dto.ipsName ?? null,
            ipsCode: dto.ipsCode ?? null,
            ipsInNetwork: dto.ipsInNetwork,
            professionalName: dto.professionalName ?? null,
            ibc: dto.ibc,
            id_contract: contract?.id ?? null,
            id_company: contract?.id_company ?? null,
            id_eps,
            id_arl,
            contractDays: calculation.contractDays,
            chainDaysBefore: calculation.chain.daysBefore,
            externalChainStart: externalChain?.start ?? null,
            externalChainDays: externalChain?.days ?? null,
            companyDays: calculation.payment.companyDays,
            entityDays: calculation.payment.entityDays,
            pensionFundDays: calculation.payment.pensionFundDays,
            recoveryStatus: initialRecoveryStatus(calculation.payment),
            approvedAmount: approvedTotal > 0 ? approvedTotal : null,
            filingDeadline: calculation.filingDeadline ? toColombianDateOnly(calculation.filingDeadline) : null,
            documentPath,
            documentName: pending.originalName,
            documentCheck: certificateDocument ? 'MATCH' : 'CONFIRMED',
            extractedData: pending.extraction as Prisma.InputJsonValue,
            observation: dto.observation ?? null,
          },
        });
      });
    } catch (error) {
      await this.storage.remove(documentPath);
      throw new Error(`Error registering inability: ${error}`);
    }
    if ('message' in created) {
      await this.storage.remove(documentPath);
      return created as ServiceError;
    }

    await this.storage.discardTemp(dto.fileToken);
    // Estado DISABLE del trabajador si la incapacidad está vigente hoy
    await this.inabilityService.syncWorkerDisableState(dto.id_worker);
    return { inability: created, calculation };
  }

  /** EPS del certificado (obligatoria salvo origen laboral). Al editar se admite la que ya tenía aunque esté inactiva */
  private async resolveEps(dto: { origin: string; id_eps?: number }, currentEpsId?: number | null): Promise<number | null | ServiceError> {
    if (dto.origin === 'LABOR' && !dto.id_eps) return null;
    if (!dto.id_eps) return { status: 400, message: 'id_eps is required for this origin' };
    const eps = await this.prisma.eps.findUnique({ where: { id: dto.id_eps } });
    if (!eps) return { status: 404, message: `EPS with id ${dto.id_eps} not found` };
    if (eps.status !== 'ACTIVE' && eps.id !== currentEpsId) return { status: 400, message: `EPS ${eps.name} is inactive` };
    return eps.id;
  }

  /**
   * Edita los datos de una incapacidad, o completa los de una antigua, y recalcula
   * quién paga y los plazos. El contrato, la empresa y la ARL se vuelven a tomar
   * en la fecha de inicio. Los días y el valor copiados solo cambian aquí.
   */
  async updateDetails(id: number, dto: UpdateInabilityDetailsDto, id_user: number, siteId?: number, role?: string) {
    const current = await this.prisma.inability.findUnique({
      where: { id },
      include: {
        worker: { select: { id_site: true } },
        _count: { select: { extensions: true, followUps: { where: { type: { not: 'DATA_CHANGE' } } } } },
      },
    });
    if (!current || (role !== 'SUPERADMIN' && siteId !== undefined && current.worker.id_site !== siteId)) {
      return { status: 404, message: `Inability with id ${id} not found` } as ServiceError;
    }

    const input = { ...dto, id_worker: current.id_worker };
    const result = await this.calculate(input, siteId, role, id);
    if ('message' in result) return result;
    const { _internal, ...calculation } = result;
    const { start, end, contract, extensionOf, externalChain, wage } = _internal;

    if (calculation.overlaps.length) {
      return {
        status: 409,
        message: `The dates overlap inability ${calculation.overlaps[0].id} of the worker`,
        details: { code: 'OVERLAP', overlaps: calculation.overlaps },
      } as ServiceError;
    }
    if (!wage) {
      return {
        status: 400,
        message: `There is no minimum wage for ${start.getUTCFullYear()}: configure it before registering`,
      } as ServiceError;
    }
    // Las prórrogas siguientes se calcularon con estos datos: no se recalculan en cascada
    const affectsChain =
      start.getTime() !== current.dateDisableStart.getTime() ||
      end.getTime() !== current.dateDisableEnd.getTime() ||
      dto.origin !== current.origin ||
      calculation.classification !== current.type;
    if (current._count.extensions > 0 && affectsChain) {
      return {
        status: 409,
        message: 'This inability has extensions registered after it: dates, origin and classification cannot be changed',
        details: { code: 'HAS_EXTENSIONS' },
      } as ServiceError;
    }

    const id_eps = await this.resolveEps(dto, current.id_eps);
    if (id_eps !== null && typeof id_eps === 'object') return id_eps;
    const id_arl = dto.origin === 'LABOR' ? (contract?.company?.arl?.id ?? null) : null;
    const cause: CauseDisability =
      dto.origin === 'LABOR' ? 'LABOR' : current.cause === 'TRANSIT' ? 'TRANSIT' : 'DISEASE';

    const data = {
      dateDisableStart: start,
      dateDisableEnd: end,
      type: calculation.classification,
      cause,
      origin: dto.origin,
      id_extension_of: extensionOf?.id ?? null,
      days: calculation.days,
      certificateNumber: dto.certificateNumber ?? null,
      authorizationNumber: dto.authorizationNumber ?? null,
      entityFilingNumber: dto.entityFilingNumber ?? null,
      issueDate: dto.issueDate ? toColombianDateOnly(dto.issueDate) : null,
      diagnosisPrincipal: dto.diagnosisPrincipal,
      diagnosesRelated: dto.diagnosesRelated ?? [],
      ipsName: dto.ipsName ?? null,
      ipsCode: dto.ipsCode ?? null,
      ipsInNetwork: dto.ipsInNetwork,
      professionalName: dto.professionalName ?? null,
      ibc: dto.ibc,
      id_contract: contract?.id ?? null,
      id_company: contract?.id_company ?? null,
      id_eps,
      id_arl,
      contractDays: calculation.contractDays,
      chainDaysBefore: calculation.chain.daysBefore,
      externalChainStart: externalChain?.start ?? null,
      externalChainDays: externalChain?.days ?? null,
      companyDays: calculation.payment.companyDays,
      entityDays: calculation.payment.entityDays,
      pensionFundDays: calculation.payment.pensionFundDays,
      approvedAmount: dto.approvedAmount ?? null,
      filingDeadline: calculation.filingDeadline ? toColombianDateOnly(calculation.filingDeadline) : null,
      observation: dto.observation ?? null,
    };
    const same = (a: unknown, b: unknown) =>
      Array.isArray(a) || Array.isArray(b)
        ? JSON.stringify(a ?? []) === JSON.stringify(b ?? [])
        : a instanceof Date || b instanceof Date
          ? (a as Date | null)?.getTime() === (b as Date | null)?.getTime()
          : a !== null && typeof a === 'object'
            ? Number(a) === Number(b)
            : a === b;
    const changed = Object.keys(data).filter((key) => !same(current[key], data[key]));
    // Sin eventos de seguimiento el estado depende de si queda algo por recobrar; si lo
    // último fue un pago, se recalcula con los días y el valor que ahora debe la entidad
    let recoveryStatus = current._count.followUps ? current.recoveryStatus : initialRecoveryStatus(calculation.payment);
    const lastEvent = await this.prisma.inabilityFollowUp.findFirst({
      where: { id_inability: id, type: { not: 'DATA_CHANGE' } },
      orderBy: [{ eventDate: 'desc' }, { id: 'desc' }],
      select: { type: true },
    });
    if (lastEvent?.type === 'PAYMENT') {
      const paid = await this.prisma.inabilityFollowUp.aggregate({
        where: { id_inability: id, type: 'PAYMENT' },
        _sum: { days: true, amount: true },
      });
      recoveryStatus = paymentStatus(
        paid._sum.days ?? 0,
        Number(paid._sum.amount ?? 0),
        owedDays(calculation.payment),
        dto.approvedAmount ?? null,
      );
    }

    const updated: any = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE "Inability" IN SHARE ROW EXCLUSIVE MODE`;
      const conflict = await this.findConflict(tx, input, start, end, id_eps, id_arl, id);
      if (conflict) return conflict;
      const row = await tx.inability.update({ where: { id }, data: { ...data, recoveryStatus } });
      if (changed.length) {
        await tx.inabilityFollowUp.create({
          data: {
            id_inability: id,
            type: 'DATA_CHANGE',
            eventDate: getColombianToday(),
            recoveryStatus,
            description: `fields:${changed.join(',')}`,
            id_user,
          },
        });
      }
      return row;
    });
    if ('message' in updated) return updated as ServiceError;

    await this.inabilityService.syncWorkerDisableState(current.id_worker);
    return { id: updated.id, calculation };
  }

  /** Validaciones bajo bloqueo de tabla: superposición y certificado duplicado */
  private async findConflict(
    tx: Prisma.TransactionClient,
    dto: { id_worker: number; certificateNumber?: string },
    start: Date,
    end: Date,
    id_eps: number | null,
    id_arl: number | null,
    excludeId?: number,
  ): Promise<ServiceError | null> {
    const notSelf = excludeId ? { id: { not: excludeId } } : {};
    const overlap = await tx.inability.findFirst({
      where: { id_worker: dto.id_worker, dateDisableStart: { lte: end }, dateDisableEnd: { gte: start }, ...notSelf },
      select: { id: true },
    });
    if (overlap) {
      return {
        status: 409,
        message: `The dates overlap inability ${overlap.id} of the worker`,
        details: { code: 'OVERLAP' },
      };
    }
    if (dto.certificateNumber && (id_eps || id_arl)) {
      const duplicate = await tx.inability.findFirst({
        where: { certificateNumber: dto.certificateNumber, ...(id_eps ? { id_eps } : { id_arl }), ...notSelf },
        select: { id: true },
      });
      if (duplicate) {
        return {
          status: 409,
          message: `Certificate ${dto.certificateNumber} is already registered (inability ${duplicate.id})`,
          details: { code: 'DUPLICATE_CERTIFICATE', inabilityId: duplicate.id },
        };
      }
    }
    return null;
  }

  /** Archivo del certificado de una incapacidad */
  async certificateFile(id: number, siteId?: number, role?: string) {
    const inability = await this.prisma.inability.findUnique({
      where: { id },
      select: { documentPath: true, documentName: true, worker: { select: { id_site: true } } },
    });
    if (!inability || (role !== 'SUPERADMIN' && siteId !== undefined && inability.worker.id_site !== siteId)) {
      return { status: 404, message: `Inability with id ${id} not found` } as ServiceError;
    }
    const path = inability.documentPath ? this.storage.resolve(inability.documentPath) : null;
    if (!path || !(await this.storage.exists(path))) {
      return { status: 404, message: `Inability ${id} has no certificate file` } as ServiceError;
    }
    return { path, name: inability.documentName ?? `incapacidad-${id}` };
  }
}

export const isRegistrationError = (r: unknown): r is ServiceError =>
  typeof (r as ServiceError)?.status === 'number' && typeof (r as ServiceError)?.message === 'string';
