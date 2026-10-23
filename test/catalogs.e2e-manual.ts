// Prueba manual de los catálogos EPS, ARL y Empresas contra la BD del .env.
// Levanta solo esos módulos (sin cron jobs) y borra lo que crea.
// Uso: npx ts-node -r tsconfig-paths/register test/catalogs.e2e-manual.ts
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { EpsModule } from 'src/eps/eps.module';
import { ArlModule } from 'src/arl/arl.module';
import { CompanyModule } from 'src/company/company.module';

let failures = 0;
function check(label: string, cond: boolean, detail?: any) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' -> ' + JSON.stringify(detail)}`);
}

// Estado de la secuencia del id: un intento fallido no debe moverla
async function seq(prisma: PrismaService, table: string) {
  const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT last_value, is_called FROM "${table}_id_seq"`);
  return `${row.last_value}/${row.is_called}`;
}

// Deja la secuencia en MAX(id) para que la prueba no deje huecos
async function restoreSeq(prisma: PrismaService, table: string) {
  await prisma.$queryRawUnsafe(
    `SELECT setval('"${table}_id_seq"', COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM "${table}"`,
  );
}

async function runCatalog(app: INestApplication, path: string, table: string, gh: string, reception: string) {
  const prisma = app.get(PrismaService);
  const seqBefore = await seq(prisma, table);
  const http = () => request(app.getHttpServer());
  const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
  const nit = `99${Date.now().toString().slice(-7)}-1`;
  const name = `  prueba ${path} ${Date.now()}  `;

  let r = await http().get(`/${path}`);
  check(`${path}: sin token -> 401`, r.status === 401, r.status);

  r = await http().post(`/${path}`).set(auth(reception)).send({ name, nit });
  check(`${path}: RECEPTION no puede crear -> 403`, r.status === 403, r.status);

  r = await http().post(`/${path}`).set(auth(gh)).send({ name: 'X', nit: '12ab' });
  check(`${path}: NIT inválido -> 400`, r.status === 400, r.body);

  r = await http().post(`/${path}`).set(auth(gh)).send({ name, nit: nit.slice(0, 3) + '.' + nit.slice(3) });
  check(`${path}: GH crea -> 201`, r.status === 201, r.body);
  const created = r.body;
  check(`${path}: nombre normalizado en mayúsculas`, created.name === name.trim().toUpperCase(), created.name);
  check(`${path}: NIT sin puntos`, created.nit === nit, created.nit);
  check(`${path}: status por defecto ACTIVE`, created.status === 'ACTIVE', created.status);
  check(`${path}: id_user desde el token`, typeof created.id_user === 'number', created.id_user);

  let seqNow = await seq(prisma, table);
  r = await http().post(`/${path}`).set(auth(gh)).send({ name: 'otro nombre ' + Date.now(), nit });
  check(`${path}: NIT duplicado -> 409`, r.status === 409, r.body);
  r = await http().post(`/${path}`).set(auth(gh)).send({ name, nit: '12345678' });
  check(`${path}: nombre duplicado -> 409`, r.status === 409 && /name/.test(r.body.message), r.body);
  check(`${path}: los 409 no consumen id`, (await seq(prisma, table)) === seqNow);

  r = await http().post(`/${path}`).set(auth(gh)).send({ name: `otra ${Date.now()}`, nit: '87654321' });
  const second = r.body;
  seqNow = await seq(prisma, table);
  r = await http().patch(`/${path}/${second.id}`).set(auth(gh)).send({ nit });
  check(`${path}: actualizar a NIT de otro -> 409`, r.status === 409, r.body);
  r = await http().patch(`/${path}/${second.id}`).set(auth(gh)).send({ nit: '87654321', name: `otra editada ${Date.now()}` });
  check(`${path}: actualizar con su propio NIT -> 200`, r.status === 200, r.body);
  check(`${path}: actualizar no consume id`, (await seq(prisma, table)) === seqNow);
  await http().delete(`/${path}/${second.id}`).set(auth(gh));

  r = await http().get(`/${path}?status=ACTIVE`).set(auth(reception));
  check(`${path}: RECEPTION puede listar`, r.status === 200 && r.body.some((e) => e.id === created.id), r.status);

  r = await http().patch(`/${path}/${created.id}`).set(auth(gh)).send({ status: 'INACTIVE' });
  check(`${path}: inactivar -> 200`, r.status === 200 && r.body.status === 'INACTIVE', r.body);

  r = await http().get(`/${path}?status=ACTIVE`).set(auth(gh));
  check(`${path}: inactiva no sale en ACTIVE`, !r.body.some((e) => e.id === created.id));

  r = await http().get(`/${path}/999999`).set(auth(gh));
  check(`${path}: id inexistente -> 404`, r.status === 404, r.status);

  r = await http().delete(`/${path}/${created.id}`).set(auth(gh));
  check(`${path}: eliminar -> 200`, r.status === 200, r.body);

  await restoreSeq(prisma, table);
  check(`${path}: secuencia restaurada (${seqBefore})`, (await seq(prisma, table)) === seqBefore, await seq(prisma, table));
}

// ARL asignada a la empresa: validaciones sin consumir ids
async function runCompanyArl(app: INestApplication, gh: string) {
  const prisma = app.get(PrismaService);
  const http = () => request(app.getHttpServer());
  const auth = { Authorization: `Bearer ${gh}` };
  const stamp = Date.now();
  const seqCompany = await seq(prisma, 'Company');
  const seqArl = await seq(prisma, 'Arl');

  const arl = (await http().post('/arl').set(auth).send({ name: `arl prueba ${stamp}`, nit: '11111111' })).body;
  const arlInactive = (await http().post('/arl').set(auth).send({ name: `arl inactiva ${stamp}`, nit: '22222222', status: 'INACTIVE' })).body;

  let seqNow = await seq(prisma, 'Company');
  let r = await http().post('/company').set(auth).send({ name: `emp ${stamp}`, nit: '33333333', id_arl: 999999 });
  check('company+arl: ARL inexistente -> 404', r.status === 404, r.body);
  r = await http().post('/company').set(auth).send({ name: `emp ${stamp}`, nit: '33333333', id_arl: arlInactive.id });
  check('company+arl: ARL inactiva -> 400', r.status === 400, r.body);
  check('company+arl: errores de ARL no consumen id', (await seq(prisma, 'Company')) === seqNow);

  r = await http().post('/company').set(auth).send({ name: `emp ${stamp}`, nit: '33333333', id_arl: arl.id });
  const company = r.body;
  check('company+arl: crea con ARL -> 201 e incluye arl', r.status === 201 && company.arl?.id === arl.id, r.body);

  r = await http().get(`/company/${company.id}`).set(auth);
  check('company+arl: GET incluye arl', r.body.arl?.name === arl.name, r.body);

  r = await http().delete(`/arl/${arl.id}`).set(auth);
  check('company+arl: no se puede borrar ARL en uso -> 409', r.status === 409, r.body);

  r = await http().patch(`/company/${company.id}`).set(auth).send({ id_arl: null });
  check('company+arl: desasignar ARL con null', r.status === 200 && r.body.id_arl === null, r.body);

  await http().delete(`/company/${company.id}`).set(auth);
  await http().delete(`/arl/${arl.id}`).set(auth);
  await http().delete(`/arl/${arlInactive.id}`).set(auth);
  await restoreSeq(prisma, 'Company');
  await restoreSeq(prisma, 'Arl');
  check('company+arl: secuencias restauradas',
    (await seq(prisma, 'Company')) === seqCompany && (await seq(prisma, 'Arl')) === seqArl);
}

async function main() {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, EpsModule, ArlModule, CompanyModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.init();

  const prisma = app.get(PrismaService);
  const user = await prisma.user.findFirst({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  const jwt = app.get(JwtService);
  const base = { id: user!.id, username: user!.username, id_site: user!.id_site, id_subsite: user!.id_subsite };
  const gh = jwt.sign({ ...base, role: 'GH' });
  const reception = jwt.sign({ ...base, role: 'RECEPTION' });

  await runCatalog(app, 'eps', 'Eps', gh, reception);
  await runCatalog(app, 'arl', 'Arl', gh, reception);
  await runCatalog(app, 'company', 'Company', gh, reception);
  await runCompanyArl(app, gh);

  const doc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token').build(),
  );
  for (const p of ['/eps', '/eps/{id}', '/arl', '/arl/{id}', '/company', '/company/{id}']) {
    const ops = Object.values(doc.paths[p] ?? {}) as any[];
    check(`swagger ${p}: documentado con tag y bearer`, ops.length > 0 && ops.every((o) => o.tags?.length && o.security?.[0]?.['access-token'] && o.summary));
  }

  await app.close();
  console.log(failures ? `\n${failures} FALLAS` : '\nTodo OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
