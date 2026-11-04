// Prueba manual del módulo de SMMLV por año contra la BD del .env.
// Usa un año de prueba (2099), lo borra y restaura la secuencia.
// Uso: npx ts-node -r tsconfig-paths/register test/minimum-wage.e2e-manual.ts
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { MinimumWageModule } from 'src/minimum-wage/minimum-wage.module';

let failures = 0;
function check(label: string, cond: boolean, detail?: any) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' -> ' + JSON.stringify(detail)}`);
}
async function seq(prisma: PrismaService) {
  const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT last_value, is_called FROM "MinimumWage_id_seq"`);
  return `${row.last_value}/${row.is_called}`;
}

async function main() {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, MinimumWageModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true, transformOptions: { enableImplicitConversion: true } }));
  await app.init();

  const prisma = app.get(PrismaService);
  const before = await seq(prisma);
  const user = await prisma.user.findFirst({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  const jwt = app.get(JwtService);
  const base = { id: user!.id, username: user!.username, id_site: user!.id_site, id_subsite: user!.id_subsite };
  const token = (role: string) => ({ Authorization: `Bearer ${jwt.sign({ ...base, role })}` });
  const http = () => request(app.getHttpServer());
  const YEAR = 2099;

  try {
    let r = await http().get('/minimum-wage');
    check('sin token -> 401', r.status === 401, r.status);
    r = await http().post('/minimum-wage').set(token('GH')).send({ year: YEAR, value: 1750905 });
    check('GH no puede crear -> 403', r.status === 403, r.status);
    r = await http().post('/minimum-wage').set(token('ADMIN')).send({ year: YEAR, value: 0 });
    check('valor 0 -> 400', r.status === 400, r.body);
    r = await http().post('/minimum-wage').set(token('ADMIN')).send({ year: 1999, value: 100 });
    check('año fuera de rango -> 400', r.status === 400, r.body);

    r = await http().post('/minimum-wage').set(token('ADMIN')).send({ year: YEAR, value: 1750905 });
    check('crea -> 201 con valor diario 58363.5', r.status === 201 && r.body.dailyValue === 58363.5, r.body);
    const created = r.body;

    const s = await seq(prisma);
    r = await http().post('/minimum-wage').set(token('SUPERADMIN')).send({ year: YEAR, value: 2000000 });
    check('año duplicado -> 409 sin consumir id', r.status === 409 && (await seq(prisma)) === s, r.body);

    r = await http().get(`/minimum-wage/year/${YEAR}`).set(token('RECEPTION'));
    check('cualquier rol consulta el año', r.status === 200 && r.body.value === 1750905, r.body);
    r = await http().get('/minimum-wage/year/2098').set(token('GH'));
    check('año sin valor -> 404', r.status === 404, r.body);
    r = await http().get('/minimum-wage').set(token('GH'));
    check('historial ordenado por año (más reciente primero)', r.status === 200 && r.body[0]?.year === YEAR, r.body);

    r = await http().patch(`/minimum-wage/${created.id}`).set(token('ADMIN')).send({ value: 1800000 });
    check('corrige el valor -> 200 y recalcula el diario', r.status === 200 && r.body.dailyValue === 60000, r.body);
    r = await http().delete(`/minimum-wage/${created.id}`).set(token('ADMIN'));
    check('elimina -> 200', r.status === 200, r.body);

    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token').build());
    const ops = Object.keys(doc.paths).filter((p) => p.startsWith('/minimum-wage')).flatMap((p) => Object.values(doc.paths[p]) as any[]);
    check(`swagger: ${ops.length} operaciones con tag, bearer y summary`, ops.length === 5 && ops.every((o) => o.tags?.[0] === 'Minimum wage' && o.security?.[0]?.['access-token'] && o.summary));
  } finally {
    await prisma.minimumWage.deleteMany({ where: { year: YEAR } });
    const [value, called] = before.split('/');
    await prisma.$queryRawUnsafe(`SELECT setval('"MinimumWage_id_seq"', ${Number(value)}, ${called === 'true'})`);
    check(`secuencia restaurada (${before})`, (await seq(prisma)) === before);
    await app.close();
  }
  console.log(failures ? `\n${failures} FALLAS` : '\nTodo OK');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
