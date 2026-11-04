// Prueba manual de los borradores de lectura de certificados contra la BD del .env.
// No llama al extractor ni a la IA: la lectura se siembra directo en el almacenamiento temporal.
// Uso: npx ts-node -r tsconfig-paths/register test/certificate-draft.e2e-manual.ts
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
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
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, InabilityModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.init();

  const prisma = app.get(PrismaService);
  const storage = app.get(CertificateStorageService);
  const jwt = app.get(JwtService);
  const [user, other] = await prisma.user.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' }, take: 2 });
  const worker = await prisma.worker.findFirst({ orderBy: { id: 'asc' }, select: { id: true, id_site: true } });
  const token = (u: typeof user, role: string, id_site: number | null = worker!.id_site) => ({
    Authorization: `Bearer ${jwt.sign({ id: u.id, username: u.username, id_site, id_subsite: u.id_subsite, role })}`,
  });
  const http = () => request(app.getHttpServer());
  const base = '/inability/certificate/drafts';
  const content = Buffer.from('%PDF-1.4 certificado de prueba');
  const fileToken = await storage.saveTemp(
    { buffer: content, originalname: 'prueba.pdf', mimetype: 'application/pdf', size: content.length },
    user.id,
    { format: 'TEST', entity: null, fields: {}, warnings: [] },
    worker!.id,
  );

  try {
    const gh = token(user, 'GH');
    let r = await http().get(base).query({ id_worker: worker!.id });
    check('sin token -> 401', r.status === 401, r.status);
    r = await http().get(base).query({ id_worker: worker!.id }).set(token(user, 'RECEPTION'));
    check('RECEPTION -> 403', r.status === 403, r.status);
    r = await http().get(base).query({ id_worker: worker!.id }).set(token(user, 'GH', worker!.id_site === 1 ? 2 : 1));
    check('trabajador de otra sede -> 403', r.status === 403, r.body);
    r = await http().get(base).query({ id_worker: 99999999 }).set(gh);
    check('trabajador inexistente -> 404', r.status === 404, r.body);

    r = await http().get(base).query({ id_worker: worker!.id }).set(gh);
    let draft = r.body.find?.((d: any) => d.fileToken === fileToken);
    check('la lectura aparece sin formulario y con la verificación del trabajador',
      r.status === 200 && draft?.draft === null && draft?.originalName === 'prueba.pdf' && draft?.worker?.id === worker!.id && !!draft?.workerCheck, r.body);
    const days = (new Date(draft.expiresAt).getTime() - new Date(draft.createdAt).getTime()) / 86_400_000;
    check('la lectura vence a los 7 días', days === 7, days);

    r = await http().put(`${base}/${fileToken}`).set(gh).send({ form: 'x' });
    check('formulario inválido -> 400', r.status === 400, r.body);
    r = await http().put(`${base}/${fileToken}`).set(gh).send({ form: { ibc: '1750905' }, selectedWorkerId: worker!.id });
    check('guarda el formulario', r.status === 200, r.body);
    r = await http().get(base).query({ id_worker: worker!.id }).set(gh);
    draft = r.body.find((d: any) => d.fileToken === fileToken);
    check('el formulario se recupera', draft?.draft?.form?.ibc === '1750905' && draft?.draft?.selectedWorkerId === worker!.id, draft?.draft);
    const stored = await storage.readTemp(fileToken);
    check('guardar el formulario conserva la lectura', stored?.extraction?.format === 'TEST', stored);

    r = await http().get(`${base}/${fileToken}/file`).set(gh).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(Buffer.from(c)));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    check('descarga el archivo original', r.status === 200 && Buffer.compare(r.body, content) === 0, r.status);

    if (other) {
      const foreign = token(other, 'GH');
      r = await http().get(base).query({ id_worker: worker!.id }).set(foreign);
      check('otro usuario no ve la lectura', r.status === 200 && !r.body.some((d: any) => d.fileToken === fileToken), r.body);
      r = await http().put(`${base}/${fileToken}`).set(foreign).send({ form: {} });
      check('otro usuario no la edita -> 403', r.status === 403, r.body);
      r = await http().get(`${base}/${fileToken}/file`).set(foreign);
      check('otro usuario no descarga el archivo -> 403', r.status === 403, r.status);
      r = await http().delete(`${base}/${fileToken}`).set(foreign);
      check('otro usuario no la descarta -> 403', r.status === 403, r.body);
    }

    r = await http().put(`${base}/..%2F..%2Fx`).set(gh).send({ form: {} });
    check('token inválido -> 404', r.status === 404, r.body);

    r = await http().delete(`${base}/${fileToken}`).set(gh);
    check('descarta la lectura', r.status === 200, r.body);
    r = await http().get(base).query({ id_worker: worker!.id }).set(gh);
    check('ya no aparece', !r.body.some((d: any) => d.fileToken === fileToken), r.body);
    r = await http().put(`${base}/${fileToken}`).set(gh).send({ form: {} });
    check('guardar una lectura descartada -> 404', r.status === 404, r.body);

    // Adjuntar sin lectura (servicio de lectura caído): no llama al extractor
    const manual = '/inability/certificate/manual';
    r = await http().post(manual).set(token(user, 'RECEPTION')).field('id_worker', String(worker!.id)).attach('file', content, 'm.pdf');
    check('manual: RECEPTION -> 403', r.status === 403, r.status);
    r = await http().post(manual).set(gh).attach('file', content, 'm.pdf');
    check('manual: sin trabajador -> 400', r.status === 400, r.body);
    r = await http().post(manual).set(token(user, 'GH', worker!.id_site === 1 ? 2 : 1)).field('id_worker', String(worker!.id)).attach('file', content, 'm.pdf');
    check('manual: trabajador de otra sede -> 403', r.status === 403, r.body);
    r = await http().post(manual).set(gh).field('id_worker', String(worker!.id)).attach('file', Buffer.from('x'), { filename: 'x.txt', contentType: 'text/plain' });
    check('manual: tipo no permitido -> 415', r.status === 415, r.body);
    r = await http()
      .post(manual)
      .set(gh)
      .field('id_worker', String(worker!.id))
      .attach('file', content, { filename: 'm.pdf', contentType: 'application/pdf' });
    check('manual: queda sin campos leídos y exige confirmar la cédula',
      r.status === 201 && r.body.extraction?.format === 'MANUAL' && r.body.workerCheck?.status === 'NOT_READ' && !!r.body.fileToken, r.body);
    const manualToken = r.body.fileToken;
    r = await http().get(base).query({ id_worker: worker!.id }).set(gh);
    check('manual: aparece para continuar después', r.body.some((d: any) => d.fileToken === manualToken && d.extraction.format === 'MANUAL'), r.body);
    if (manualToken) await storage.discardTemp(manualToken);
  } finally {
    await storage.discardTemp(fileToken);
    await app.close();
  }
  console.log(failures ? `\n${failures} FALLAS` : '\nTodo OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
