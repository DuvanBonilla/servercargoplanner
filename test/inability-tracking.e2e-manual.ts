// Prueba manual del seguimiento de incapacidades contra la BD del .env, sin IA. Usa un
// trabajador sin incapacidades. Todo lo que crea se borra y las secuencias vuelven a su valor anterior.
// Uso: INABILITY_STORAGE_DIR=<carpeta temporal> npx ts-node -r tsconfig-paths/register test/inability-tracking.e2e-manual.ts
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { InabilityModule } from 'src/inability/inability.module';

let failures = 0;
function check(label: string, cond: boolean, detail?: any) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' -> ' + JSON.stringify(detail)}`);
}

const SEQUENCES = ['Inability', 'InabilityFollowUp'];
async function seq(prisma: PrismaService, table: string) {
  const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT last_value, is_called FROM "${table}_id_seq"`);
  return { value: Number(row.last_value), called: row.is_called as boolean };
}

async function main() {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, InabilityModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.init();

  const prisma = app.get(PrismaService);
  const jwt = app.get(JwtService);
  const user = await prisma.user.findFirst({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  const worker = await prisma.worker.findFirst({ where: { inability: { none: {} }, status: 'AVALIABLE' }, orderBy: { id: 'asc' } });
  if (!user || !worker) throw new Error('A user and a worker without inabilities are required');
  const token = (role: string, id_site: number | null = worker.id_site) => ({
    Authorization: `Bearer ${jwt.sign({ id: user.id, username: user.username, id_site, id_subsite: null, role })}`,
  });
  const gh = token('GH');
  const http = () => request(app.getHttpServer());
  const eps = await prisma.eps.findFirst({ where: { status: 'ACTIVE' } });

  const snapshots = await Promise.all(SEQUENCES.map((t) => seq(prisma, t)));
  const year = 2026;
  const wage = await prisma.minimumWage.findUnique({ where: { year } });
  const createdWage = !wage ? await prisma.minimumWage.create({ data: { year, value: 1750905, id_user: user.id } }) : null;
  const workerState = { status: worker.status, dateDisableStart: worker.dateDisableStart, dateDisableEnd: worker.dateDisableEnd };
  const ids: number[] = [];

  const legacy = await prisma.inability.create({
    data: { id_worker: worker.id, id_user: user.id, dateDisableStart: new Date('2026-03-01'), dateDisableEnd: new Date('2026-03-05'), type: 'INITIAL', cause: 'DISEASE' },
  });
  ids.push(legacy.id);
  const url = `/inability/${legacy.id}`;
  const details = {
    startDate: '2026-03-01',
    endDate: '2026-03-05',
    origin: 'GENERAL',
    classification: 'INITIAL',
    diagnosisPrincipal: 'M545',
    ibc: 1750905,
    ipsInNetwork: true,
    id_eps: eps?.id,
    certificateNumber: 'CERT-TEST',
    approvedAmount: 200000,
  };

  try {
    // Permisos y datos sensibles
    let r = await http().get('/inability/tracking');
    check('sin token -> 401', r.status === 401, r.status);
    r = await http().get('/inability/tracking').set(token('SUPERVISOR'));
    check('SUPERVISOR no ve el seguimiento -> 403', r.status === 403, r.status);
    r = await http().get(`${url}/certificate`).set(token('SUPERVISOR'));
    check('SUPERVISOR no abre el certificado -> 403', r.status === 403, r.status);
    r = await http().post(`${url}/follow-ups`).set(token('GH', worker.id_site === 1 ? 2 : 1)).send({ type: 'NOTE', eventDate: '2026-03-02', description: 'x' });
    check('incapacidad de otra sede -> 404', r.status === 404, r.body);

    // Antigua: se lista sin datos y por radicar
    r = await http().get('/inability/tracking').set(gh);
    let row = r.body.find((i: any) => i.id === legacy.id);
    check('listado: aparece con estado PENDING y sin certificado', row?.recoveryStatus === 'PENDING' && row?.hasCertificate === false, row);
    check('listado: no expone la ruta ni la lectura del archivo', row && !('documentPath' in row) && !('extractedData' in row), row);
    r = await http().get(`${url}/certificate`).set(gh);
    check('sin certificado -> 404', r.status === 404, r.body);

    // Completar y editar
    r = await http().patch(`${url}/details`).set(gh).send({ ...details, ibc: 1000 });
    check('editar: IBC menor al SMMLV -> 400', r.status === 400, r.body);
    const statusBefore = (await prisma.inability.findUnique({ where: { id: legacy.id } }))!.companyDays;
    check('editar: el intento fallido no cambia nada', statusBefore === null, statusBefore);
    r = await http().patch(`${url}/details`).set(gh).send(details);
    check('editar: completa la antigua y calcula quién paga', r.status === 200 && r.body.calculation?.payment?.companyDays === 2 && r.body.calculation?.payment?.entityDays === 3, r.body);
    r = await http().get(`${url}/tracking`).set(gh);
    row = r.body;
    check('editar: quedan los datos y el valor aprobado', row.diagnosisPrincipal === 'M545' && row.ibc === 1750905 && row.approvedAmount === 200000 && row.filingDeadline === '2026-03-31', row);
    check('editar: el cambio queda en el historial', row.followUps[0]?.type === 'DATA_CHANGE' && row.followUps[0].description.includes('ibc'), row.followUps);
    const events = row.followUps.length;
    r = await http().patch(`${url}/details`).set(gh).send(details);
    r = await http().get(`${url}/tracking`).set(gh);
    check('editar sin cambios: no agrega historial', r.body.followUps.length === events, r.body.followUps);

    const other = await prisma.inability.create({
      data: { id_worker: worker.id, id_user: user.id, dateDisableStart: new Date('2026-04-01'), dateDisableEnd: new Date('2026-04-02'), type: 'INITIAL', cause: 'DISEASE' },
    });
    ids.push(other.id);
    r = await http().post(`/inability/${other.id}/follow-ups`).set(gh).send({ type: 'PAYMENT', eventDate: '2026-04-05', amount: 1000, days: 1 });
    check('pago en una antigua sin completar -> 400', r.status === 400 && /Complete the inability data/.test(r.body.message), r.body);
    r = await http().patch(`${url}/details`).set(gh).send({ ...details, endDate: '2026-04-01' });
    check('editar: fechas que se cruzan con otra -> 409', r.status === 409 && r.body.code === 'OVERLAP', r.body);
    r = await http().patch(`/inability/${other.id}/details`).set(gh).send({ ...details, startDate: '2026-04-01', endDate: '2026-04-02' });
    check('editar: certificado repetido -> 409', r.status === 409 && r.body.code === 'DUPLICATE_CERTIFICATE', r.body);

    r = await http().patch(url).set(gh).send({ dateDisableEnd: '2026-03-06' });
    check('la edición antigua no altera una registrada', r.body.status === 409 || r.status === 409, r.body);

    // Seguimiento
    const post = (body: object) => http().post(`${url}/follow-ups`).set(gh).send(body);
    r = await post({ type: 'FILING', eventDate: '2026-03-10' });
    check('radicar sin número -> 400', r.status === 400, r.body);
    r = await post({ type: 'NOTE', eventDate: '2099-01-01', description: 'x' });
    check('fecha futura -> 400', r.status === 400, r.body);
    r = await post({ type: 'NOTE', eventDate: '2026-02-01', description: 'x' });
    check('fecha anterior a la incapacidad -> 400', r.status === 400, r.body);
    r = await post({ type: 'DATA_CHANGE', eventDate: '2026-03-10', description: 'x' });
    check('el historial de cambios no se escribe a mano -> 400', r.status === 400, r.body);
    r = await post({ type: 'PAYMENT', eventDate: '2026-03-10', amount: 100 });
    check('pago sin días -> 400', r.status === 400, r.body);
    const failed = await prisma.inabilityFollowUp.count({ where: { id_inability: legacy.id, type: { not: 'DATA_CHANGE' } } });
    check('los intentos fallidos no crean eventos', failed === 0, failed);

    r = await post({ type: 'FILING', eventDate: '2026-03-10', filingNumber: 'RAD-1', nail: 'NAIL-1' });
    check('radicar -> FILED con radicado y NAIL', r.status === 201 && r.body.recoveryStatus === 'FILED' && r.body.currentFilingNumber === 'RAD-1' && r.body.currentNail === 'NAIL-1', r.body);
    r = await post({ type: 'REJECTION', eventDate: '2026-03-20', description: 'Falta soporte' });
    check('rechazo -> REJECTED', r.body.recoveryStatus === 'REJECTED', r.body);
    r = await post({ type: 'FILING', eventDate: '2026-03-25', filingNumber: 'RAD-2' });
    check('nueva radicación: vale el último radicado y se conserva el NAIL', r.body.currentFilingNumber === 'RAD-2' && r.body.currentNail === 'NAIL-1', r.body);
    r = await post({ type: 'PQR', eventDate: '2026-04-20', pqrNumber: 'PQR-1' });
    check('PQR -> IN_RECOVERY', r.body.recoveryStatus === 'IN_RECOVERY' && r.body.lastPqrNumber === 'PQR-1', r.body);
    r = await post({ type: 'PAYMENT', eventDate: '2026-05-01', amount: 150000.5, days: 2, recoveryStatus: 'PAID' });
    check('pago de 2 de 3 días -> el sistema lo deja parcial aunque se envíe PAID',
      r.body.recoveryStatus === 'PARTIALLY_PAID' && r.body.paidAmount === 150000.5 && r.body.pendingAmount === 49999.5 && r.body.paidDays === 2 && r.body.owedDays === 3, r.body);
    r = await post({ type: 'PAYMENT', eventDate: '2026-05-10', amount: 49999.5, days: 1 });
    check('pago que completa días y valor aprobado -> PAID sin saldo', r.body.recoveryStatus === 'PAID' && r.body.pendingAmount === 0 && r.body.paidDays === 3, r.body);
    r = await http().patch(`${url}/details`).set(gh).send({ ...details, approvedAmount: 300000 });
    r = await http().get(`${url}/tracking`).set(gh);
    check('subir el valor aprobado después del pago -> vuelve a parcial', r.body.recoveryStatus === 'PARTIALLY_PAID' && r.body.pendingAmount === 100000, r.body);

    const first = r.body.followUps.find((f: any) => f.type === 'FILING');
    r = await http().delete(`${url}/follow-ups/${first.id}`).set(gh);
    check('solo se elimina el último evento -> 409', r.status === 409, r.body);
    const last = (await http().get(`${url}/tracking`).set(gh)).body.followUps.find((f: any) => f.type === 'PAYMENT');
    r = await http().delete(`${url}/follow-ups/${last.id}`).set(gh);
    check('eliminar el último: vuelve al estado anterior y deja constancia',
      r.status === 200 && r.body.recoveryStatus === 'PARTIALLY_PAID' && r.body.paidAmount === 150000.5 &&
      r.body.followUps.some((f: any) => f.type === 'DATA_CHANGE' && f.description.startsWith('deleted:PAYMENT')), r.body);

    r = await http().delete(url).set(gh);
    check('con seguimiento no se elimina -> 409', r.status === 409, r.body);

    // Certificado
    r = await http().post(`${url}/certificate`).set(gh).attach('file', Buffer.from('texto'), { filename: 'x.txt', contentType: 'text/plain' });
    check('tipo de archivo no permitido -> 415', r.status === 415, r.body);
    const content = Buffer.from('%PDF-1.4 prueba');
    r = await http().post(`${url}/certificate`).set(gh).attach('file', content, { filename: 'cert.pdf', contentType: 'application/pdf' });
    check('carga el certificado', r.status === 201 && r.body.hasCertificate === true && r.body.documentName === 'cert.pdf', r.body);
    const open = () =>
      http().get(`${url}/certificate`).set(gh).buffer(true).parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(Buffer.from(c)));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    r = await open();
    check('abre el certificado', r.status === 200 && Buffer.compare(r.body, content) === 0, r.status);
    r = await open();
    check('lo abre las veces que sea necesario', r.status === 200, r.status);

    // Lo que asume la empresa no se recobra
    r = await http().patch(`/inability/${other.id}/details`).set(gh).send({ ...details, startDate: '2026-04-01', endDate: '2026-04-02', certificateNumber: undefined, approvedAmount: undefined });
    r = await http().get(`/inability/${other.id}/tracking`).set(gh);
    check('solo días de la empresa -> NOT_APPLICABLE', r.body.recoveryStatus === 'NOT_APPLICABLE', r.body);

    // Listados generales sin datos médicos
    r = await http().get(`/inability/${legacy.id}`).set(token('SUPERVISOR'));
    check('el detalle general no expone diagnóstico ni IBC', r.status === 200 && !('diagnosisPrincipal' in r.body) && !('ibc' in r.body), r.body);
    r = await http().delete(url).set(token('SUPERVISOR'));
    check('SUPERVISOR no elimina una registrada', r.status === 409, r.body);

    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token').build());
    const op = doc.paths['/inability/{id}/follow-ups']?.post as any;
    check('swagger: documentado', !!op?.summary && op.tags?.includes('Inability tracking'), op);
  } finally {
    await prisma.inabilityFollowUp.deleteMany({ where: { id_inability: { in: ids } } });
    await prisma.inability.deleteMany({ where: { id: { in: ids } } });
    if (createdWage) {
      await prisma.minimumWage.delete({ where: { id: createdWage.id } });
      await prisma.$queryRawUnsafe(`SELECT setval('"MinimumWage_id_seq"', GREATEST((SELECT COALESCE(MAX(id), 1) FROM "MinimumWage"), 1), (SELECT COUNT(*) > 0 FROM "MinimumWage"))`);
    }
    await prisma.worker.update({ where: { id: worker.id }, data: workerState });
    await Promise.all(
      SEQUENCES.map((t, i) => prisma.$queryRawUnsafe(`SELECT setval('"${t}_id_seq"', ${snapshots[i].value}, ${snapshots[i].called})`)),
    );
    await app.close();
  }
  console.log(failures ? `\n${failures} FALLAS` : '\nTodo OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
