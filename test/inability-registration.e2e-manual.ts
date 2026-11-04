// Prueba manual de POST /inability/register/preview, POST /inability/register y
// GET /inability/:id/certificate contra la BD del .env. No usa la IA: la lectura
// del certificado se simula guardando un token con datos ficticios. Todo lo que
// crea se borra y las secuencias vuelven exactamente a su valor anterior.
// Uso: npx ts-node -r tsconfig-paths/register test/inability-registration.e2e-manual.ts
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { existsSync } from 'fs';
import * as request from 'supertest';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { InabilityModule } from 'src/inability/inability.module';
import { CertificateStorageService } from 'src/inability/service/certificate-storage.service';
import { calculatePayment } from 'src/inability/inability-rules';

let failures = 0;
function check(label: string, cond: boolean, detail?: any) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' -> ' + JSON.stringify(detail)}`);
}

async function seq(prisma: PrismaService, table: string) {
  const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT last_value, is_called FROM "${table}_id_seq"`);
  return `${row.last_value}/${row.is_called}`;
}
async function restoreSeq(prisma: PrismaService, table: string, snapshot: string) {
  const [value, called] = snapshot.split('/');
  await prisma.$queryRawUnsafe(`SELECT setval('"${table}_id_seq"', ${Number(value)}, ${called === 'true'})`);
}

function rules() {
  const base = { startDate: new Date('2026-03-01T00:00:00Z'), chainRootStart: null, contractDays: 200 };
  let p = calculatePayment({ ...base, origin: 'GENERAL', days: 5, classification: 'INITIAL', chainDaysBefore: 0 });
  check('reglas: general inicial -> empresa 2, EPS 3', p.companyDays === 2 && p.entityDays === 3, p);
  p = calculatePayment({ ...base, origin: 'LABOR', days: 5, classification: 'INITIAL', chainDaysBefore: 0 });
  check('reglas: laboral inicial -> empresa 1, ARL 4', p.companyDays === 1 && p.entityDays === 4 && p.entity === 'ARL', p);
  p = calculatePayment({ ...base, origin: 'MATERNITY', days: 126, classification: 'INITIAL', chainDaysBefore: 0, contractDays: 3 });
  check('reglas: licencia -> todo EPS aun con <28 días', p.entityDays === 126 && p.companyDays === 0, p);
  p = calculatePayment({ ...base, origin: 'GENERAL', days: 5, classification: 'INITIAL', chainDaysBefore: 0, contractDays: 27 });
  check('reglas: 27 días de contrato -> empresa paga todo', p.companyDays === 5, p);
  p = calculatePayment({ ...base, origin: 'GENERAL', days: 5, classification: 'INITIAL', chainDaysBefore: 0, contractDays: 28 });
  check('reglas: 28 días de contrato -> regla normal', p.companyDays === 2, p);
  p = calculatePayment({
    ...base, origin: 'GENERAL', days: 5, classification: 'EXTENSION', chainDaysBefore: 178,
    chainRootStart: new Date('2025-09-01T00:00:00Z'),
  });
  check('reglas: prórroga días 179-183 -> EPS 2, fondo de pensiones 3', p.entityDays === 2 && p.pensionFundDays === 3 && p.companyDays === 0, p);
  p = calculatePayment({
    ...base, origin: 'GENERAL', days: 3, classification: 'EXTENSION', chainDaysBefore: 10,
    chainRootStart: new Date('2026-02-01T00:00:00Z'),
  });
  check('reglas: prórroga a 28 días del inicio de la inicial -> empresa 2', p.companyDays === 2 && p.segments[0].reason === 'EXTENSION_WITHIN_30_DAYS', p);
}

async function main() {
  rules();

  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, InabilityModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.init();

  const prisma = app.get(PrismaService);
  const storage = app.get(CertificateStorageService);
  const jwt = app.get(JwtService);
  const http = () => request(app.getHttpServer());

  const users = await prisma.user.findMany({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' }, take: 2 });
  const user = users[0];
  const other = users[1];
  const token = (role: string, u = user) => ({
    Authorization: `Bearer ${jwt.sign({ id: u.id, username: u.username, id_site: u.id_site, id_subsite: u.id_subsite, role })}`,
  });

  // Trabajador de la sede del usuario sin incapacidades ni contratos
  const worker = await prisma.worker.findFirst({
    where: { id_site: user.id_site!, status: 'AVALIABLE', inability: { none: {} }, contracts: { none: {} } },
    orderBy: { id: 'asc' },
  });
  const company = await prisma.company.findFirst({ where: { status: 'ACTIVE' }, include: { arl: true } });
  const eps = await prisma.eps.findFirst({ where: { status: 'ACTIVE' } });
  if (!worker || !company || !eps) throw new Error('Se requiere un trabajador libre, una empresa y una EPS activas');

  const seqs = {
    Inability: await seq(prisma, 'Inability'),
    WorkerContract: await seq(prisma, 'WorkerContract'),
    MinimumWage: await seq(prisma, 'MinimumWage'),
  };
  const workerBefore = { status: worker.status, dateDisableStart: worker.dateDisableStart, dateDisableEnd: worker.dateDisableEnd };
  const createdWage = (await prisma.minimumWage.findUnique({ where: { year: 2026 } }))
    ? null
    : await prisma.minimumWage.create({ data: { year: 2026, value: 1750905, id_user: user.id } });
  const contract = await prisma.workerContract.create({
    data: {
      id_worker: worker.id, id_company: company.id, startDate: new Date('2026-01-01T00:00:00Z'),
      endDate: new Date('2026-12-31T00:00:00Z'), workerType: 'OPERATIVE', contractType: 'FIXED_1_YEAR', id_user: user.id,
    },
  });

  const fakeExtraction = (dni: string | null, extra: Record<string, unknown> = {}) => ({
    format: 'TEST',
    engine: 'test',
    entity: { type: 'EPS', name: eps.name, nit: eps.nit },
    warnings: [],
    fields: {
      workerDocumentNumber: { value: dni, confidence: 'high' },
      workerName: { value: 'NOMBRE DEL CERTIFICADO', confidence: 'high' },
      classification: { value: 'INITIAL', confidence: 'high' },
      ...extra,
    },
  });
  const upload = (dni: string | null, owner = user) =>
    storage.saveTemp(
      { buffer: Buffer.from('%PDF-1.4 certificado de prueba'), originalname: 'certificado.pdf', mimetype: 'application/pdf', size: 30 },
      owner.id,
      fakeExtraction(dni),
    );
  const body = (fileToken: string, over: Record<string, unknown> = {}) => ({
    fileToken, id_worker: worker.id, startDate: '2026-03-02', endDate: '2026-03-06', origin: 'GENERAL',
    diagnosisPrincipal: 'm54.5', ibc: 1750905, ipsInNetwork: true, id_eps: eps.id, certificateNumber: 'TEST-0001', ...over,
  });
  const created: number[] = [];
  const files: string[] = [];
  const pre = '/inability/register/preview';
  const reg = '/inability/register';

  try {
    let r = await http().post(pre).send({});
    check('preview sin token -> 401', r.status === 401, r.status);
    r = await http().post(pre).set(token('RECEPTION')).send(body('x'));
    check('preview RECEPTION -> 403', r.status === 403, r.status);

    const p0 = { id_worker: worker.id, startDate: '2026-03-02', endDate: '2026-03-06', origin: 'GENERAL', diagnosisPrincipal: 'M545' };
    r = await http().post(pre).set(token('GH')).send({ ...p0, ipsInNetwork: false });
    check('preview inicial: 5 días, INICIAL, empresa 2 / EPS 3',
      r.status === 201 && r.body.days === 5 && r.body.classification === 'INITIAL' && r.body.payment.companyDays === 2 && r.body.payment.entityDays === 3, r.body);
    check('preview: contrato y 60 días de contrato', r.body.contract?.id === contract.id && r.body.contractDays === 60 && r.body.company?.id === company.id, r.body);
    check('preview: radicar en 15 días (IPS no adscrita) y recobro a 3 años', r.body.filingDeadline === '2026-03-17' && r.body.recoveryDeadline === '2029-03-02', r.body);
    check('preview: no expone datos internos', r.body._internal === undefined);

    r = await http().post(pre).set(token('GH')).send({ ...p0, startDate: '2026-01-15', endDate: '2026-01-19' });
    check('preview: 14 días de contrato -> empresa paga los 5', r.body.contractDays === 14 && r.body.payment.companyDays === 5, r.body.payment);
    r = await http().post(pre).set(token('GH')).send({ ...p0, origin: 'LABOR' });
    check('preview laboral: empresa 1, ARL 4', r.body.payment.companyDays === 1 && r.body.payment.entity === 'ARL' && r.body.payment.entityDays === 4, r.body.payment);
    r = await http().post(pre).set(token('GH')).send({ ...p0, ibc: 1000000 });
    check('preview: IBC menor al SMMLV -> 400', r.status === 400, r.body);
    r = await http().post(pre).set(token('GH')).send({ ...p0, endDate: '2026-03-01' });
    check('preview: fin antes del inicio -> 400', r.status === 400, r.body);
    r = await http().post(pre).set(token('GH')).send({ ...p0, classification: 'EXTENSION' });
    check('preview: prórroga sin anterior -> 400', r.status === 400, r.body);

    // Registro A (inicial)
    const seqBefore = await seq(prisma, 'Inability');
    r = await http().post(reg).set(token('GH')).send(body('00000000'));
    check('registro con token mal formado -> 400', r.status === 400, r.body);
    r = await http().post(reg).set(token('GH')).send(body('3f1c2b7a-8d4e-4b1a-9c3e-2a6f5d7e8b90'));
    check('registro con token inexistente/vencido -> 404', r.status === 404, r.body);
    const otherToken = await upload(worker.dni, other);
    r = await http().post(reg).set(token('GH')).send(body(otherToken));
    check('token leído por otro usuario -> 403', r.status === 403, r.body);
    await storage.discardTemp(otherToken);

    const mismatch = await upload('1000000999');
    r = await http().post(reg).set(token('GH')).send(body(mismatch));
    check('cédula distinta -> 409 WORKER_MISMATCH con ambos documentos',
      r.status === 409 && r.body.code === 'WORKER_MISMATCH' && r.body.certificateDocument === '1000000999' && r.body.selectedWorker?.id === worker.id, r.body);
    await storage.discardTemp(mismatch);

    const notRead = await upload(null);
    r = await http().post(reg).set(token('GH')).send(body(notRead));
    check('cédula no leída sin confirmar -> 400 DOCUMENT_NOT_CONFIRMED', r.status === 400 && r.body.code === 'DOCUMENT_NOT_CONFIRMED', r.body);
    r = await http().post(reg).set(token('GH')).send(body(notRead, { ibc: 900000, documentConfirmed: true }));
    check('IBC menor al SMMLV -> 400', r.status === 400, r.body);
    r = await http().post(reg).set(token('GH')).send(body(notRead, { id_eps: undefined, documentConfirmed: true }));
    check('origen general sin EPS -> 400', r.status === 400, r.body);
    check('los rechazos no consumen ids', (await seq(prisma, 'Inability')) === seqBefore, { before: seqBefore, after: await seq(prisma, 'Inability') });

    const tokenA = await upload(worker.dni);
    r = await http().post(reg).set(token('GH')).send(body(tokenA));
    const a = r.body.inability;
    if (a?.id) created.push(a.id);
    if (a?.documentPath) files.push(a.documentPath);
    check('registro A: 201 inicial con días de pago',
      r.status === 201 && a.type === 'INITIAL' && a.days === 5 && a.companyDays === 2 && a.entityDays === 3 && a.diagnosisPrincipal === 'M545', r.body);
    check('registro A: copia contrato, empresa, EPS e IBC',
      a?.id_contract === contract.id && a?.id_company === company.id && a?.id_eps === eps.id && a?.ibc === 1750905 && a?.documentCheck === 'MATCH');
    check('registro A: id consecutivo (sin huecos)', a?.id === Number(seqBefore.split('/')[0]) + (seqBefore.endsWith('true') ? 1 : 0), { id: a?.id, seqBefore });
    check('registro A: archivo guardado y token consumido',
      !!a?.documentPath && existsSync(storage.resolve(a.documentPath)!) && (await storage.readTemp(tokenA)) === null);

    r = await http().post(reg).set(token('GH')).send(body(notRead, { documentConfirmed: true, certificateNumber: 'TEST-0002' }));
    check('fechas superpuestas -> 409 OVERLAP', r.status === 409 && r.body.code === 'OVERLAP', r.body);
    r = await http().post(reg).set(token('GH')).send(body(notRead, { documentConfirmed: true, startDate: '2026-05-01', endDate: '2026-05-02' }));
    check('certificado duplicado -> 409 DUPLICATE_CERTIFICATE', r.status === 409 && r.body.code === 'DUPLICATE_CERTIFICATE', r.body);

    // B: mismo diagnóstico (en relacionado), 4 días después del fin de A -> prórroga
    r = await http().post(pre).set(token('GH')).send({ ...p0, startDate: '2026-03-10', endDate: '2026-03-14', diagnosisPrincipal: 'J00X', diagnosesRelated: ['S400', 'F431', 'm54.5'] });
    check('preview B: sugiere PRÓRROGA de A (mismo código, 4 días)',
      r.body.suggestion?.classification === 'EXTENSION' && r.body.suggestion?.previous?.id === a?.id && r.body.suggestion?.gapDays === 4 && r.body.suggestion?.sharedDiagnosis === 'M545', r.body.suggestion);
    check('preview B: dentro de 30 días del inicio de la inicial -> empresa 2', r.body.payment?.companyDays === 2 && r.body.chain?.daysBefore === 5, r.body.payment);

    const tokenB = await upload(worker.dni);
    r = await http().post(reg).set(token('GH')).send(body(tokenB, { startDate: '2026-03-10', endDate: '2026-03-14', diagnosisPrincipal: 'J00X', diagnosesRelated: ['S400', 'F431', 'M545'], certificateNumber: 'TEST-0003' }));
    const b = r.body.inability;
    if (b?.id) created.push(b.id);
    if (b?.documentPath) files.push(b.documentPath);
    check('registro B: prórroga de A', r.status === 201 && b.type === 'EXTENSION' && b.id_extension_of === a?.id && b.chainDaysBefore === 5, r.body);
    check('registro B: guarda los 3 diagnósticos relacionados', JSON.stringify(b?.diagnosesRelated) === '["S400","F431","M545"]', b?.diagnosesRelated);
    check('registro B: id consecutivo', b?.id === a?.id + 1, { a: a?.id, b: b?.id });

    // C: 27 días después del fin de B, 39 desde el inicio de A -> prórroga, la EPS paga todo
    r = await http().post(pre).set(token('GH')).send({ ...p0, startDate: '2026-04-10', endDate: '2026-04-12' });
    check('preview C: prórroga de B a 39 días del inicio -> EPS paga todo',
      r.body.classification === 'EXTENSION' && r.body.extensionOf?.id === b?.id && r.body.payment?.companyDays === 0 && r.body.payment?.entityDays === 3 && r.body.chain?.daysBefore === 10, r.body);
    // D: 31 días después -> nueva inicial
    r = await http().post(pre).set(token('GH')).send({ ...p0, startDate: '2026-04-15', endDate: '2026-04-16' });
    check('preview D: 32 días después del fin -> INICIAL', r.body.classification === 'INITIAL' && r.body.suggestion?.reason === 'NO_PREVIOUS_WITH_SAME_DIAGNOSIS_WITHIN_30_DAYS', r.body.suggestion);
    r = await http().post(pre).set(token('GH')).send({ ...p0, startDate: '2026-04-15', endDate: '2026-04-16', classification: 'INITIAL' });
    check('preview: la clasificación confirmada igual a la sugerida no avisa', !r.body.warnings.some((w: string) => w.startsWith('CLASSIFICATION')), r.body.warnings);
    r = await http().post(pre).set(token('GH')).send({ ...p0, startDate: '2026-03-20', endDate: '2026-03-21', classification: 'INITIAL' });
    check('preview: forzar INICIAL cuando es prórroga avisa', r.body.warnings.some((w: string) => w.startsWith('CLASSIFICATION_DIFFERS')), r.body.warnings);

    // Prórroga cuya anterior no está en el sistema
    const pe = { ...p0, startDate: '2026-06-05', endDate: '2026-06-09', classification: 'EXTENSION' };
    r = await http().post(pre).set(token('GH')).send({ ...pe, externalChainStart: '2026-05-20' });
    check('externa: inicio sin días -> 400', r.status === 400, r.body);
    r = await http().post(pre).set(token('GH')).send({ ...pe, externalChainStart: '2026-06-05', externalChainDays: 1 });
    check('externa: inicio no anterior a la prórroga -> 400', r.status === 400, r.body);
    r = await http().post(pre).set(token('GH')).send({ ...pe, externalChainStart: '2026-05-20', externalChainDays: 17 });
    check('externa: más días de los transcurridos -> 400', r.status === 400, r.body);
    r = await http().post(pre).set(token('GH')).send({ ...pe, classification: 'INITIAL', externalChainStart: '2026-05-20', externalChainDays: 10 });
    check('externa: solo se permite en prórroga -> 400', r.status === 400, r.body);
    r = await http().post(pre).set(token('GH')).send({ ...pe, id_extension_of: a?.id, externalChainStart: '2026-05-20', externalChainDays: 10 });
    check('externa: no se combina con id_extension_of -> 400', r.status === 400, r.body);
    r = await http().post(pre).set(token('GH')).send({ ...pe, externalChainStart: '2026-05-20', externalChainDays: 10 });
    check('externa: 16 días desde la inicial -> empresa 2, días acumulados 10, avisa',
      r.status === 201 && r.body.classification === 'EXTENSION' && r.body.payment.companyDays === 2 && r.body.chain.daysBefore === 10 &&
      r.body.chain.rootStartDate === '2026-05-20' && r.body.warnings.some((w: string) => w.startsWith('EXTERNAL_CHAIN')) &&
      !r.body.warnings.some((w: string) => w.startsWith('CLASSIFICATION')), r.body);
    r = await http().post(pre).set(token('GH')).send({ ...pe, externalChainStart: '2025-01-01', externalChainDays: 178 });
    check('externa: 178 días acumulados -> EPS 2, fondo de pensiones 3, empresa 0',
      r.body.payment?.companyDays === 0 && r.body.payment?.entityDays === 2 && r.body.payment?.pensionFundDays === 3, r.body.payment);
    const tokenE = await upload(worker.dni);
    r = await http().post(reg).set(token('GH')).send(body(tokenE, {
      startDate: '2026-06-05', endDate: '2026-06-09', classification: 'EXTENSION', externalChainStart: '2026-05-20', externalChainDays: 10, certificateNumber: 'TEST-0004',
    }));
    const e = r.body.inability;
    if (e?.id) created.push(e.id);
    if (e?.documentPath) files.push(e.documentPath);
    check('externa: registra la prórroga y guarda los datos digitados',
      r.status === 201 && e.type === 'EXTENSION' && e.id_extension_of === null && e.externalChainDays === 10 && e.chainDaysBefore === 10, r.body);
    r = await http().post(pre).set(token('GH')).send({ ...p0, startDate: '2026-06-12', endDate: '2026-06-13' });
    check('externa: la siguiente prórroga hereda inicio y días de la cadena',
      r.body.extensionOf?.id === e?.id && r.body.chain?.daysBefore === 15 && r.body.chain?.rootStartDate === '2026-05-20' && r.body.chain?.externalDays === 10, r.body.chain);

    r = await http().get(`/inability/${a?.id}/certificate`).set(token('GH'));
    check('GET certificado: 200 PDF', r.status === 200 && String(r.headers['content-type']).includes('application/pdf'), r.status);
    r = await http().get('/inability/99999999/certificate').set(token('GH'));
    check('GET certificado inexistente -> 404', r.status === 404, r.status);
    await storage.discardTemp(notRead);

    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token').build());
    const ops = [doc.paths['/inability/register']?.post, doc.paths['/inability/register/preview']?.post, doc.paths['/inability/{id}/certificate']?.get] as any[];
    check('swagger: endpoints documentados con tag Inability registration', ops.every((op) => op?.tags?.includes('Inability registration') && op.summary), ops.map((o) => o?.tags));
  } finally {
    for (const id of [...created].reverse()) await prisma.inability.delete({ where: { id } });
    for (const f of files) await storage.remove(f);
    await prisma.workerContract.delete({ where: { id: contract.id } });
    if (createdWage) await prisma.minimumWage.delete({ where: { id: createdWage.id } });
    await prisma.worker.update({ where: { id: worker.id }, data: workerBefore });
    for (const [table, snap] of Object.entries(seqs)) await restoreSeq(prisma, table, snap);
    check('secuencias restauradas', (await seq(prisma, 'Inability')) === seqs.Inability && (await seq(prisma, 'WorkerContract')) === seqs.WorkerContract);
    await app.close();
  }
  console.log(failures ? `\n${failures} FALLAS` : '\nTodo OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
