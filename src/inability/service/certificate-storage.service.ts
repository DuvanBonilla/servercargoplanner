import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { extname, join, normalize, sep } from 'path';
import type { UploadedCertificate } from './certificate-extraction.service';

/** Una lectura sin registrar se descarta después de este tiempo */
const TEMP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EXTENSIONS: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/tiff': '.tif',
  'image/webp': '.webp',
};

/** Formulario a medio llenar, para continuar el registro sin volver a leer el certificado */
export interface CertificateDraft {
  form: Record<string, unknown>;
  selectedWorkerId?: number;
}

/** Lo que se guarda junto al archivo al leerlo, para validar el registro en el servidor */
export interface PendingCertificate {
  id_user: number;
  id_worker?: number | null;
  draft?: CertificateDraft;
  originalName: string;
  mimetype: string;
  size: number;
  createdAt: string;
  /** Respuesta del extractor: el registro compara la cédula con esta lectura, no con lo que envíe el cliente */
  extraction: any;
}

/**
 * Almacena los certificados. Al leer un certificado se guarda temporalmente
 * (token); al registrar la incapacidad pasa a su carpeta definitiva por año.
 * Hoy es una carpeta del servidor (INABILITY_STORAGE_DIR); al habilitar el
 * acceso SFTP a Hostinger solo cambia esta clase.
 */
@Injectable()
export class CertificateStorageService {
  constructor(private readonly config: ConfigService) {}

  private get root() {
    return this.config.get<string>('INABILITY_STORAGE_DIR') || join(process.cwd(), 'storage');
  }

  private tempPaths(token: string) {
    const dir = join(this.root, 'tmp');
    return { dir, file: join(dir, `${token}.bin`), meta: join(dir, `${token}.json`) };
  }

  isAllowedType(mimetype: string) {
    return mimetype in EXTENSIONS;
  }

  /** Guarda directo en la ubicación definitiva (certificado cargado sin lectura) */
  async saveFinal(file: UploadedCertificate, year: number): Promise<string> {
    const relative = join('inability', String(year), `${randomUUID()}${this.extensionOf(file.mimetype, file.originalname)}`);
    await fs.mkdir(join(this.root, 'inability', String(year)), { recursive: true });
    await fs.writeFile(join(this.root, relative), file.buffer);
    return relative.split(sep).join('/');
  }

  /** El archivo puede faltar si el almacenamiento se movió o se borró a mano */
  async exists(path: string) {
    return fs.access(path).then(
      () => true,
      () => false,
    );
  }

  extensionOf(mimetype: string, originalName: string) {
    return EXTENSIONS[mimetype] ?? (extname(originalName).toLowerCase() || '.bin');
  }

  async saveTemp(file: UploadedCertificate, id_user: number, extraction: any, id_worker?: number | null): Promise<string> {
    await this.cleanupTemp();
    const token = randomUUID();
    const paths = this.tempPaths(token);
    await fs.mkdir(paths.dir, { recursive: true });
    const meta: PendingCertificate = {
      id_user,
      id_worker: id_worker ?? null,
      originalName: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      createdAt: new Date().toISOString(),
      extraction,
    };
    await fs.writeFile(paths.file, file.buffer);
    await fs.writeFile(paths.meta, JSON.stringify(meta));
    return token;
  }

  /** null si el token no existe, expiró o no tiene formato válido */
  async readTemp(token: string): Promise<PendingCertificate | null> {
    if (!TOKEN_RE.test(token)) return null;
    try {
      const meta: PendingCertificate = JSON.parse(await fs.readFile(this.tempPaths(token).meta, 'utf-8'));
      if (Date.now() - new Date(meta.createdAt).getTime() > TEMP_TTL_MS) return null;
      return meta;
    } catch {
      return null;
    }
  }

  /** Lecturas sin registrar de un usuario para un trabajador, de la más reciente a la más antigua */
  async listTemp(id_user: number, id_worker: number) {
    await this.cleanupTemp();
    const names = await fs.readdir(this.tempPaths('x').dir).catch(() => [] as string[]);
    const tokens = names.filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -'.json'.length));
    const items = await Promise.all(tokens.map(async (token) => ({ token, meta: await this.readTemp(token) })));
    return items
      .filter((i): i is { token: string; meta: PendingCertificate } => i.meta?.id_user === id_user && i.meta?.id_worker === id_worker)
      .sort((a, b) => b.meta.createdAt.localeCompare(a.meta.createdAt));
  }

  /** Se escribe a un archivo aparte y se renombra: un registro simultáneo nunca lee un JSON a medias */
  async saveDraft(token: string, meta: PendingCertificate, draft: CertificateDraft) {
    const paths = this.tempPaths(token);
    const part = `${paths.meta}.part`;
    await fs.writeFile(part, JSON.stringify({ ...meta, draft }));
    await fs.rename(part, paths.meta);
  }

  tempFilePath(token: string) {
    return this.tempPaths(token).file;
  }

  expiresAt(meta: PendingCertificate) {
    return new Date(new Date(meta.createdAt).getTime() + TEMP_TTL_MS).toISOString();
  }

  /**
   * Copia el archivo temporal a su ubicación definitiva y devuelve la ruta
   * relativa. Se hace ANTES de insertar la incapacidad para no consumir un id
   * si falla el archivo; si falla el insert, se borra con remove().
   */
  async promote(token: string, meta: PendingCertificate, year: number): Promise<string> {
    const relative = join('inability', String(year), `${token}${this.extensionOf(meta.mimetype, meta.originalName)}`);
    const target = join(this.root, relative);
    await fs.mkdir(join(this.root, 'inability', String(year)), { recursive: true });
    await fs.copyFile(this.tempPaths(token).file, target);
    return relative.split(sep).join('/');
  }

  async discardTemp(token: string) {
    const paths = this.tempPaths(token);
    await Promise.all([fs.rm(paths.file, { force: true }), fs.rm(paths.meta, { force: true })]);
  }

  /** Ruta absoluta de un archivo guardado; null si la ruta intenta salir del almacenamiento */
  resolve(relativePath: string): string | null {
    const full = normalize(join(this.root, relativePath));
    return full.startsWith(normalize(this.root) + sep) ? full : null;
  }

  async remove(relativePath: string) {
    const full = this.resolve(relativePath);
    if (full) await fs.rm(full, { force: true });
  }

  private async cleanupTemp() {
    const dir = this.tempPaths('x').dir;
    const names = await fs.readdir(dir).catch(() => [] as string[]);
    const now = Date.now();
    await Promise.all(
      names.map(async (name) => {
        const path = join(dir, name);
        const stat = await fs.stat(path).catch(() => null);
        if (stat && now - stat.mtimeMs > TEMP_TTL_MS) await fs.rm(path, { force: true });
      }),
    );
  }
}
