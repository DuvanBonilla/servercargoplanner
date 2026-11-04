import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from 'src/prisma/prisma.service';
import { getColombianToday } from 'src/common/utils/dateColombia';
import { AiUsageService } from 'src/ai-usage/ai-usage.service';
import { CertificateStorageService, type CertificateDraft } from './certificate-storage.service';

/** Archivo recibido por multer (solo los campos que se usan) */
export interface UploadedCertificate {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

type ServiceError = { status: number; message: string };
type WorkerContext = {
  worker: { id: number; name: string; dni: string; id_site: number } | null;
  currentContract: { id: number; company: { id: number; name: string; nit: string } | null } | null;
};

const EXTRACTION_TIMEOUT_MS = 90_000;
/** Certificado adjuntado sin lectura: el usuario digita todos los campos */
const MANUAL_EXTRACTION = { format: 'MANUAL', engine: 'manual', entity: null, fields: {}, warnings: ['MANUAL_ENTRY'] };
const nitDigits = (nit?: string | null) => (nit ?? '').replace(/\D/g, '').slice(0, 9);
const docDigits = (doc?: unknown) => String(doc ?? '').replace(/\D/g, '');
/** Palabras significativas de un nombre de entidad (sin tildes ni siglas genéricas) */
const GENERIC_WORDS = ['EPS', 'ARL', 'SAS', 'SEGUROS', 'COMPANIA', 'ENTIDAD', 'VIDA'];
const nameWords = (name?: string | null) =>
  (name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !GENERIC_WORDS.includes(w));

/**
 * Lee un certificado de incapacidad con el servicio extractor (Python, en
 * localhost) y lo relaciona con los datos de CargoPlanner: trabajador
 * seleccionado, empresa de su contrato vigente y catálogos de EPS/ARL.
 */
@Injectable()
export class CertificateExtractionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly aiUsage: AiUsageService,
    private readonly storage: CertificateStorageService,
  ) {}

  private get extractorUrl() {
    return this.config.get<string>('EXTRACTOR_URL') ?? 'http://127.0.0.1:8001';
  }

  /** Trabajador seleccionado (validando la sede) y su contrato vigente hoy */
  private async workerContext(id_worker: number | undefined, siteId?: number, role?: string): Promise<WorkerContext | ServiceError> {
    if (id_worker === undefined) return { worker: null, currentContract: null };
    const worker = await this.prisma.worker.findUnique({
      where: { id: id_worker },
      select: { id: true, name: true, dni: true, id_site: true },
    });
    if (!worker) return { status: 404, message: `Worker with id ${id_worker} not found` };
    if (role !== 'SUPERADMIN' && siteId !== undefined && worker.id_site !== siteId) {
      return { status: 403, message: 'Not authorized to register inabilities of workers from another site' };
    }
    const today = getColombianToday();
    const currentContract = await this.prisma.workerContract.findFirst({
      where: {
        id_worker,
        isLegacy: false,
        startDate: { lte: today },
        OR: [{ endDate: null }, { endDate: { gte: today } }],
      },
      select: { id: true, company: { select: { id: true, name: true, nit: true } } },
    });
    return { worker, currentContract };
  }

  async extract(file: UploadedCertificate, id_user: number, id_worker?: number, siteId?: number, role?: string) {
    const context = await this.workerContext(id_worker, siteId, role);
    if ('status' in context) return context;
    const { worker, currentContract } = context;

    const extraction = await this.callExtractor(file, worker?.dni, currentContract?.company?.nit);
    if ('status' in extraction && typeof extraction.status === 'number') return extraction as ServiceError;

    // Consumo de IA: se registra aunque después no se guarde la incapacidad (ya se cobró)
    if (extraction.usage) {
      await this.aiUsage.log({
        provider: extraction.usage.provider,
        model: extraction.usage.model,
        purpose: 'INABILITY_CERTIFICATE',
        inputTokens: extraction.usage.inputTokens,
        outputTokens: extraction.usage.outputTokens,
        totalTokens: extraction.usage.totalTokens,
        costUsd: extraction.usage.costUsd,
        id_user,
        id_worker: worker?.id ?? null,
      });
    }

    // El archivo y la lectura quedan en el servidor: el registro los usa con este token
    const fileToken = await this.storage.saveTemp(file, id_user, extraction, worker?.id);

    return { fileToken, ...(await this.describe(extraction, context, siteId, role)) };
  }

  /**
   * Adjunta el certificado sin leerlo (servicio de lectura caído o documento
   * ilegible). No hay cédula leída: al registrar, el usuario debe confirmar que
   * el certificado es del trabajador.
   */
  async attachManual(file: UploadedCertificate, id_user: number, id_worker: number, siteId?: number, role?: string) {
    const context = await this.workerContext(id_worker, siteId, role);
    if ('status' in context) return context;
    if (!this.storage.isAllowedType(file.mimetype)) {
      return { status: 415, message: `Certificate could not be extracted: unsupported file type ${file.mimetype}` };
    }
    const fileToken = await this.storage.saveTemp(file, id_user, MANUAL_EXTRACTION, id_worker);
    return { fileToken, ...(await this.describe(MANUAL_EXTRACTION, context, siteId, role)) };
  }

  /** Lecturas sin registrar del usuario para el trabajador: se continúan sin volver a gastar tokens de IA */
  async listDrafts(id_worker: number, id_user: number, siteId?: number, role?: string) {
    const context = await this.workerContext(id_worker, siteId, role);
    if ('status' in context) return context;
    const pending = await this.storage.listTemp(id_user, id_worker);
    return Promise.all(
      pending.map(async ({ token, meta }) => ({
        fileToken: token,
        originalName: meta.originalName,
        mimetype: meta.mimetype,
        createdAt: meta.createdAt,
        expiresAt: this.storage.expiresAt(meta),
        draft: meta.draft ?? null,
        ...(await this.describe(meta.extraction, context, siteId, role)),
      })),
    );
  }

  private async ownDraft(token: string, id_user: number) {
    const meta = await this.storage.readTemp(token);
    if (!meta) return { status: 404, message: 'Certificate upload not found or expired: read the certificate again' };
    if (meta.id_user !== id_user) return { status: 403, message: 'This certificate was read by another user' };
    return meta;
  }

  async saveDraft(token: string, draft: CertificateDraft, id_user: number) {
    const meta = await this.ownDraft(token, id_user);
    if ('status' in meta) return meta;
    await this.storage.saveDraft(token, meta, draft);
    return { fileToken: token, expiresAt: this.storage.expiresAt(meta) };
  }

  async draftFile(token: string, id_user: number) {
    const meta = await this.ownDraft(token, id_user);
    if ('status' in meta) return meta;
    return { path: this.storage.tempFilePath(token), mimetype: meta.mimetype, name: meta.originalName };
  }

  async discardDraft(token: string, id_user: number) {
    const meta = await this.ownDraft(token, id_user);
    if ('status' in meta) return meta;
    await this.storage.discardTemp(token);
    return { fileToken: token };
  }

  /** Relaciona una lectura con el trabajador seleccionado y los catálogos, con los datos de hoy */
  private async describe(extraction: any, { worker, currentContract }: WorkerContext, siteId?: number, role?: string) {
    // La entidad del certificado se relaciona con el catálogo por NIT (sin dígito de
    // verificación) y, si el certificado no trae NIT (ej. Mutualser), por nombre
    const entityNit = nitDigits(extraction.entity?.nit);
    const entityWords = nameWords(extraction.entity?.name);
    const [eps, arl] = await Promise.all([this.prisma.eps.findMany(), this.prisma.arl.findMany()]);
    const pick = (rows: { id: number; name: string; nit: string; status: string }[]) => {
      const match =
        (entityNit ? rows.find((r) => nitDigits(r.nit) === entityNit) : undefined) ??
        (entityWords.length ? rows.find((r) => nameWords(r.name).some((w) => entityWords.includes(w))) : undefined);
      return match ? { id: match.id, name: match.name, status: match.status } : null;
    };

    return {
      worker: worker ? { id: worker.id, name: worker.name, dni: worker.dni } : null,
      workerCheck: await this.checkWorker(extraction, worker, siteId, role),
      currentContract,
      catalogMatch: {
        eps: extraction.entity?.type === 'EPS' ? pick(eps) : null,
        arl: extraction.entity?.type === 'ARL' ? pick(arl) : null,
      },
      extraction,
    };
  }

  /**
   * El certificado solo se puede registrar al trabajador seleccionado si su
   * documento coincide. Si no coincide, se muestran ambos y, si el documento
   * del certificado pertenece a otro trabajador, se sugiere para corregir la selección.
   */
  private async checkWorker(
    extraction: any,
    worker: { id: number; name: string; dni: string } | null,
    siteId?: number,
    role?: string,
  ) {
    const certificateDocument = docDigits(extraction.fields?.workerDocumentNumber?.value) || null;
    const certificateName = extraction.fields?.workerName?.value ?? null;
    const status = !worker
      ? 'NO_WORKER_SELECTED'
      : !certificateDocument
        ? 'NOT_READ'
        : certificateDocument === docDigits(worker.dni)
          ? 'MATCH'
          : 'MISMATCH';

    let suggestedWorker: { id: number; name: string; dni: string; status: string } | null = null;
    let suggestedWorkerOtherSite = false;
    if (status !== 'MATCH' && certificateDocument) {
      const found = await this.prisma.worker.findUnique({
        where: { dni: certificateDocument },
        select: { id: true, name: true, dni: true, status: true, id_site: true },
      });
      if (found && (role === 'SUPERADMIN' || siteId === undefined || found.id_site === siteId)) {
        suggestedWorker = { id: found.id, name: found.name, dni: found.dni, status: found.status };
      } else if (found) {
        suggestedWorkerOtherSite = true; // existe en otra sede: no se exponen sus datos
      }
    }

    return {
      status,
      canRegister: status === 'MATCH',
      selectedWorker: worker ? { id: worker.id, name: worker.name, dni: worker.dni } : null,
      certificateDocument,
      certificateName,
      suggestedWorker,
      suggestedWorkerOtherSite,
    };
  }

  private async callExtractor(file: UploadedCertificate, expectedDni?: string, expectedEmployerNit?: string): Promise<any> {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file.buffer)], { type: file.mimetype }), file.originalname);
    if (expectedDni) form.append('expectedDni', expectedDni);
    if (expectedEmployerNit) form.append('expectedEmployerNit', expectedEmployerNit);

    const apiKey = this.config.get<string>('EXTRACTOR_API_KEY');
    let response: Response;
    try {
      response = await fetch(`${this.extractorUrl}/extract`, {
        method: 'POST',
        body: form,
        headers: apiKey ? { 'X-API-Key': apiKey } : undefined,
        signal: AbortSignal.timeout(EXTRACTION_TIMEOUT_MS),
      });
    } catch (error) {
      return { status: 503, message: `Certificate extraction service is unavailable: ${error}` };
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const detail = typeof body?.detail === 'string' ? body.detail : response.statusText;
      // 401 = clave mal configurada entre backend y extractor: es un problema del servidor
      const status = [400, 413, 415, 422].includes(response.status) ? response.status : 502;
      return { status, message: `Certificate could not be extracted: ${detail}` };
    }
    return response.json();
  }
}
