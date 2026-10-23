// Prueba manual del módulo de contratos contra la BD del .env.
// Usa trabajadores y empresa temporales, los borra y restaura las secuencias.
// Uso: npx ts-node -r tsconfig-paths/register test/worker-contract.e2e-manual.ts
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { WorkerContractModule } from 'src/worker-contract/worker-contract.module';
import { WorkerContractService } from 'src/worker-contract/worker-contract.service';

let failures = 0;
function check(label: string, cond: boolean, detail?: any) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' -> ' + JSON.stringify(detail)}`);
}
const day = (d: any) => (d ? new Date(d).toISOString().slice(0, 10) : null);

async function seq(prisma: PrismaService, table: string) {
  const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT last_value, is_called FROM "${table}_id_seq"`);
  return `${row.last_value}/${row.is_called}`;
}
// Devuelve la secuencia exactamente al valor que tenía antes de la prueba
async function restoreSeq(prisma: PrismaService, table: string, snapshot: string) {
  const [value, called] = snapshot.split('/');
  await prisma.$queryRawUnsafe(`SELECT setval('"${table}_id_seq"', ${Number(value)}, ${called === 'true'})`);
}

async function main() {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, WorkerContractModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.init();

  const prisma = app.get(PrismaService);
  const service = app.get(WorkerContractService);
  const tables = ['Worker', 'WorkerContract', 'Company'];
  const before = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await seq(prisma, t)])));

  const user = await prisma.user.findFirst({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  const jwt = app.get(JwtService);
  const base = { id: user!.id, username: user!.username, id_site: user!.id_site, id_subsite: user!.id_subsite };
  const gh = { Authorization: `Bearer ${jwt.sign({ ...base, role: 'GH' })}` };
  const reception = { Authorization: `Bearer ${jwt.sign({ ...base, role: 'RECEPTION' })}` };
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-8);

  const company = await prisma.company.create({ data: { name: `EMP PRUEBA ${stamp}`, nit: `7${stamp}`, id_user: user!.id } });
  const inactiveCompany = await prisma.company.create({
    data: { name: `EMP INACTIVA ${stamp}`, nit: `8${stamp}`, id_user: user!.id, status: 'INACTIVE' },
  });
  const worker = await prisma.worker.create({
    data: { dni: `T${stamp}`, name: 'TRABAJADOR PRUEBA CONTRATOS', id_user: user!.id, id_site: user!.id_site ?? 1 },
  });
  const retired = await prisma.worker.create({
    data: {
      dni: `R${stamp}`, name: 'TRABAJADOR RETIRADO PRUEBA', id_user: user!.id, id_site: user!.id_site ?? 1,
      status: 'DEACTIVATED', dateRetierment: new Date('2025-05-31T00:00:00.000Z'),
    },
  });

  try {
    const body = (extra: any = {}) => ({
      id_worker: worker.id, id_company: company.id, startDate: '2026-01-01', endDate: '2026-06-30', workerType: 'OPERATIVE', ...extra,
    });

    let r = await http().post('/worker-contract').send(body());
    check('sin token -> 401', r.status === 401, r.status);
    r = await http().post('/worker-contract').set(reception).send(body());
    check('RECEPTION no puede crear -> 403', r.status === 403, r.status);

    let s = await seq(prisma, 'WorkerContract');
    r = await http().post('/worker-contract').set(gh).send(body({ endDate: undefined }));
    check('endDate obligatoria -> 400', r.status === 400, r.body);
    r = await http().post('/worker-contract').set(gh).send(body({ startDate: '2026-07-01' }));
    check('inicio después del fin -> 400', r.status === 400, r.body);
    r = await http().post('/worker-contract').set(gh).send(body({ id_company: inactiveCompany.id }));
    check('empresa inactiva -> 400', r.status === 400, r.body);
    r = await http().post('/worker-contract').set(gh).send(body({ id_company: 999999 }));
    check('empresa inexistente -> 404', r.status === 404, r.body);
    r = await http().post('/worker-contract').set(gh).send(body({ id_worker: 99999999 }));
    check('trabajador inexistente -> 404', r.status === 404, r.body);
    check('los errores no consumen id', (await seq(prisma, 'WorkerContract')) === s);

    r = await http().post('/worker-contract').set(gh).send(body());
    check('crea contrato 1 -> 201 con empresa', r.status === 201 && r.body.company?.id === company.id, r.body);
    const c1 = r.body;
    let w = await prisma.worker.findUnique({ where: { id: worker.id } });
    check('dateRetierment = fin del contrato', day(w!.dateRetierment) === '2026-06-30', w!.dateRetierment);

    s = await seq(prisma, 'WorkerContract');
    r = await http().post('/worker-contract').set(gh).send(body({ startDate: '2026-06-15', endDate: '2026-12-31' }));
    check('contrato que se cruza -> 409', r.status === 409, r.body);
    check('el 409 no consume id', (await seq(prisma, 'WorkerContract')) === s);

    r = await http().post('/worker-contract').set(gh).send(body({ startDate: '2026-07-01', endDate: '2026-12-31', workerType: 'ADMINISTRATIVE' }));
    check('crea contrato 2 (cambio de periodo) -> 201', r.status === 201, r.body);
    const c2 = r.body;
    w = await prisma.worker.findUnique({ where: { id: worker.id } });
    check('dateRetierment = fin del último contrato', day(w!.dateRetierment) === '2026-12-31', w!.dateRetierment);

    r = await http().get(`/worker-contract/worker/${worker.id}`).set(reception);
    check('historial ordenado (más reciente primero)', r.status === 200 && r.body[0]?.id === c2.id && r.body[1]?.id === c1.id, r.body);
    r = await http().get(`/worker-contract/worker/${worker.id}/current?date=2026-03-15`).set(gh);
    check('vigente el 2026-03-15 = contrato 1', r.body.id === c1.id, r.body);
    r = await http().get(`/worker-contract/worker/${worker.id}/current?date=2027-03-15`).set(gh);
    check('sin contrato vigente -> 404', r.status === 404, r.body);

    r = await http().patch(`/worker-contract/${c1.id}`).set(gh).send({ endDate: '2026-07-15' });
    check('editar fin para cruzarse -> 409', r.status === 409, r.body);
    r = await http().patch(`/worker-contract/${c1.id}`).set(gh).send({ endDate: '2026-06-20' });
    check('editar fin sin cruce -> 200', r.status === 200 && day(r.body.endDate) === '2026-06-20', r.body);

    r = await http().get('/worker-contract/expiring?days=36500').set(gh);
    const ids = Array.isArray(r.body) ? r.body.map((c) => c.id) : [];
    check('alerta incluye el último contrato', ids.includes(c2.id), r.body);
    check('alerta excluye contrato con uno posterior', !ids.includes(c1.id));

    const err = await service.applyRetirementDate(prisma, worker.id, new Date('2026-10-01T00:00:00.000Z'));
    const c2db = await prisma.workerContract.findUnique({ where: { id: c2.id } });
    check('desactivar el 2026-10-01 cierra el contrato en esa fecha', !err && day(c2db!.endDate) === '2026-10-01', { err, c2db });
    const err2 = await service.applyRetirementDate(prisma, worker.id, new Date('2025-01-01T00:00:00.000Z'));
    check('retiro antes de todo contrato -> 409', err2?.status === 409, err2);

    r = await http().post('/worker-contract').set(gh).send(body({ id_worker: retired.id, startDate: '2025-05-01', endDate: '2025-12-31' }));
    check('reactivar con inicio antes del retiro -> 409', r.status === 409, r.body);
    r = await http().post('/worker-contract').set(gh).send(body({ id_worker: retired.id, startDate: '2025-06-01', endDate: '2025-12-31' }));
    check('contrato a trabajador DEACTIVATED -> 201', r.status === 201, r.body);
    const hist = await prisma.workerContract.findMany({ where: { id_worker: retired.id }, orderBy: { id: 'asc' } });
    check('crea histórico legacy con su fecha de retiro', hist.length === 2 && hist[0].isLegacy && day(hist[0].endDate) === '2025-05-31' && hist[0].id_company === null, hist);
    const rw = await prisma.worker.findUnique({ where: { id: retired.id } });
    check('trabajador reactivado (AVALIABLE)', rw!.status === 'AVALIABLE' && day(rw!.dateRetierment) === '2025-12-31', rw);

    r = await http().patch(`/worker-contract/${hist[0].id}`).set(gh).send({ id_company: company.id, startDate: '2024-01-01', workerType: 'OPERATIVE' });
    check('completar contrato legacy -> 200', r.status === 200 && r.body.company?.id === company.id, r.body);

    r = await http().delete(`/worker-contract/${c2.id}`).set(gh);
    w = await prisma.worker.findUnique({ where: { id: worker.id } });
    check('eliminar contrato resincroniza dateRetierment', r.status === 200 && day(w!.dateRetierment) === '2026-06-20', w!.dateRetierment);

    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token').build());
    const paths = Object.keys(doc.paths).filter((p) => p.startsWith('/worker-contract'));
    const ops = paths.flatMap((p) => Object.values(doc.paths[p]) as any[]);
    check(`swagger: ${ops.length} operaciones con tag, bearer y summary`, ops.length === 7 && ops.every((o) => o.tags?.[0] === 'Worker contracts' && o.security?.[0]?.['access-token'] && o.summary), paths);
  } finally {
    await prisma.workerContract.deleteMany({ where: { id_worker: { in: [worker.id, retired.id] } } });
    await prisma.worker.deleteMany({ where: { id: { in: [worker.id, retired.id] } } });
    await prisma.company.deleteMany({ where: { id: { in: [company.id, inactiveCompany.id] } } });
    for (const t of tables) await restoreSeq(prisma, t, before[t]);
    const after = Object.fromEntries(await Promise.all(tables.map(async (t) => [t, await seq(prisma, t)])));
    check(`secuencias restauradas ${JSON.stringify(after)}`, JSON.stringify(after) === JSON.stringify(before), before);
    await app.close();
  }
  console.log(failures ? `\n${failures} FALLAS` : '\nTodo OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
