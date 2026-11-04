// Prueba manual de POST /inability/certificate/extract contra la BD del .env y el
// extractor Python en marcha (EXTRACTOR_URL). No guarda nada.
// Los certificados reales NO están en el repo: se leen de SAMPLES_DIR con su expected.json.
// Uso: SAMPLES_DIR=C:/Users/LENOVO/Desktop/scan npx ts-node -r tsconfig-paths/register test/certificate-extraction.e2e-manual.ts
import { readFileSync } from 'fs';
import { join } from 'path';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { InabilityModule } from 'src/inability/inability.module';
import { CertificateStorageService } from 'src/inability/service/certificate-storage.service';

let failures = 0;
function check(label: string, cond: boolean, detail?: any) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' -> ' + JSON.stringify(detail)}`);
}

async function main() {
  const samplesDir = process.env.SAMPLES_DIR;
  if (!samplesDir) throw new Error('SAMPLES_DIR is required');
  const expected: Record<string, { expectedDni: string; format: string; fields: Record<string, unknown> }> = JSON.parse(
    readFileSync(join(samplesDir, 'expected.json'), 'utf-8'),
  );

  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, InabilityModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.init();

  const prisma = app.get(PrismaService);
  const user = await prisma.user.findFirst({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  const jwt = app.get(JwtService);
  const token = (role: string, id_site: number | null = user!.id_site) => ({
    Authorization: `Bearer ${jwt.sign({ id: user!.id, username: user!.username, id_site, id_subsite: user!.id_subsite, role })}`,
  });
  const http = () => request(app.getHttpServer());
  const url = '/inability/certificate/extract';
  const workerOf = async (dni: string) => prisma.worker.findUnique({ where: { dni }, select: { id: true, id_site: true } });

  try {
    const [name, nueva] = Object.entries(expected).find(([, c]) => c.format === 'NUEVA_EPS')!;
    const file = readFileSync(join(samplesDir, name));
    const worker = await workerOf(nueva.expectedDni);

    let r = await http().post(url).attach('file', file, name);
    check('sin token -> 401', r.status === 401, r.status);
    r = await http().post(url).set(token('RECEPTION')).attach('file', file, name);
    check('RECEPTION no puede extraer -> 403', r.status === 403, r.status);
    r = await http().post(url).set(token('GH')).field('id_worker', '1');
    check('sin archivo -> 400', r.status === 400, r.body);
    r = await http().post(url).set(token('SUPERADMIN')).field('id_worker', '99999999').attach('file', file, name);
    check('trabajador inexistente -> 404', r.status === 404, r.body);

    if (worker) {
      const otherSite = worker.id_site === 1 ? 2 : 1;
      r = await http().post(url).set(token('GH', otherSite)).field('id_worker', String(worker.id)).attach('file', file, name);
      check('trabajador de otra sede -> 403', r.status === 403, r.body);

      r = await http().post(url).set(token('GH', worker.id_site)).field('id_worker', String(worker.id)).attach('file', file, name);
      const ex = r.body.extraction;
      check(`Nueva EPS: 201 con formato ${nueva.format}`, r.status === 201 && ex?.format === nueva.format, r.body);
      check('Nueva EPS: trabajador relacionado', r.body.worker?.id === worker.id);
      const pending = await app.get(CertificateStorageService).readTemp(r.body.fileToken ?? '');
      check('Nueva EPS: fileToken guardado con la lectura', pending?.extraction?.format === nueva.format, r.body.fileToken);
      if (r.body.fileToken) await app.get(CertificateStorageService).discardTemp(r.body.fileToken);
      check('Nueva EPS: workerCheck MATCH y se puede registrar', r.body.workerCheck?.status === 'MATCH' && r.body.workerCheck?.canRegister === true, r.body.workerCheck);
      check('Nueva EPS: cédula confirmada (high) sin WORKER_MISMATCH',
        ex?.fields?.workerDocumentNumber?.confidence === 'high' && !ex.warnings.some((w: string) => w.startsWith('WORKER_MISMATCH')), ex?.warnings);
      for (const [key, value] of Object.entries(nueva.fields)) {
        if (ex?.fields?.[key]?.value !== value) check(`Nueva EPS: ${key}`, false, { read: ex?.fields?.[key], expected: value });
      }
      check('Nueva EPS: todos los campos esperados coinciden', Object.entries(nueva.fields).every(([k, v]) => ex?.fields?.[k]?.value === v));
    } else {
      check('el trabajador de la muestra Nueva EPS existe en la BD', false);
    }

    // Certificado de otra persona: debe avisar que no coincide con el trabajador seleccionado
    const [suraName, sura] = Object.entries(expected).find(([, c]) => c.format === 'SURA' && c.expectedDni !== nueva.expectedDni)!;
    if (worker) {
      r = await http().post(url).set(token('SUPERADMIN')).field('id_worker', String(worker.id)).attach('file', readFileSync(join(samplesDir, suraName)), suraName);
      check('certificado de otra persona -> WORKER_MISMATCH', r.status === 201 && r.body.extraction.warnings.some((w: string) => w.startsWith('WORKER_MISMATCH')), r.body.extraction?.warnings);
      const suraWorker = await workerOf(sura.expectedDni);
      check('otra persona: MISMATCH, no se puede registrar y muestra ambos documentos',
        r.body.workerCheck?.status === 'MISMATCH' && r.body.workerCheck?.canRegister === false &&
        r.body.workerCheck?.selectedWorker?.id === worker.id && r.body.workerCheck?.certificateDocument === sura.expectedDni, r.body.workerCheck);
      check('otra persona: sugiere el trabajador del certificado', !suraWorker || r.body.workerCheck?.suggestedWorker?.id === suraWorker.id, r.body.workerCheck);
    }

    // Sin trabajador: solo extrae
    r = await http().post(url).set(token('ADMIN')).attach('file', readFileSync(join(samplesDir, suraName)), suraName);
    check('sin id_worker: extrae sin validar trabajador', r.status === 201 && r.body.worker === null && r.body.extraction.fields.certificateNumber.value === sura.fields.certificateNumber, r.body);
    check('sin id_worker: NO_WORKER_SELECTED y no se puede registrar', r.body.workerCheck?.status === 'NO_WORKER_SELECTED' && r.body.workerCheck?.canRegister === false, r.body.workerCheck);

    r = await http().post(url).set(token('ADMIN')).attach('file', Buffer.from('no es un pdf'), { filename: 'x.pdf', contentType: 'application/pdf' });
    check('archivo dañado -> 422', r.status === 422, r.body);

    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token').build());
    const op = doc.paths['/inability/certificate/extract']?.post as any;
    check('swagger: documentado (tag, bearer, multipart)',
      !!op && op.tags?.includes('Inability certificate') && !!op.requestBody?.content?.['multipart/form-data'] && !!op.summary, op);
  } finally {
    await app.close();
  }
  console.log(failures ? `\n${failures} FALLAS` : '\nTodo OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
