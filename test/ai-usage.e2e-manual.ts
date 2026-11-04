// Prueba manual del registro y consulta de consumo de IA contra la BD del .env.
// Inserta registros de prueba en un año sin uso real (2099), los borra y restaura la secuencia.
// Uso: npx ts-node -r tsconfig-paths/register test/ai-usage.e2e-manual.ts
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as request from 'supertest';
import { PrismaModule } from 'src/prisma/prisma.module';
import { PrismaService } from 'src/prisma/prisma.service';
import { AiUsageModule } from 'src/ai-usage/ai-usage.module';
import { AiUsageService } from 'src/ai-usage/ai-usage.service';

let failures = 0;
function check(label: string, cond: boolean, detail?: any) {
  if (!cond) failures++;
  console.log(`${cond ? 'OK  ' : 'FAIL'} ${label}${cond ? '' : ' -> ' + JSON.stringify(detail)}`);
}
async function seq(prisma: PrismaService) {
  const [row] = await prisma.$queryRawUnsafe<any[]>(`SELECT last_value, is_called FROM "AiUsageLog_id_seq"`);
  return `${row.last_value}/${row.is_called}`;
}

async function main() {
  const moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, AiUsageModule],
  }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.init();

  const prisma = app.get(PrismaService);
  const service = app.get(AiUsageService);
  const before = await seq(prisma);
  const user = await prisma.user.findFirst({ where: { status: 'ACTIVE' }, orderBy: { id: 'asc' } });
  const jwt = app.get(JwtService);
  const token = (role: string) => ({ Authorization: `Bearer ${jwt.sign({ id: user!.id, username: user!.username, id_site: user!.id_site, role })}` });
  const http = () => request(app.getHttpServer());
  const ids: number[] = [];

  try {
    const entry = (model: string, costUsd: number) => ({
      provider: 'openai', model, purpose: 'INABILITY_CERTIFICATE', inputTokens: 1000, outputTokens: 200, totalTokens: 1200, costUsd, id_user: user!.id,
    });
    // 31-ene-2099 21:00 hora Colombia = 1-feb-2099 02:00 UTC: debe contar en enero
    const lateJanuary = await service.log(entry('gpt-6-luna', 0.0002));
    await prisma.aiUsageLog.update({ where: { id: lateJanuary.id }, data: { createdAt: new Date('2099-02-01T02:00:00.000Z') } });
    const feb1 = await service.log(entry('gpt-6-luna', 0.0003));
    await prisma.aiUsageLog.update({ where: { id: feb1.id }, data: { createdAt: new Date('2099-02-10T15:00:00.000Z') } });
    const feb2 = await service.log(entry('gpt-4.1-mini', 0.0007));
    await prisma.aiUsageLog.update({ where: { id: feb2.id }, data: { createdAt: new Date('2099-02-11T15:00:00.000Z') } });
    ids.push(lateJanuary.id, feb1.id, feb2.id);

    let r = await http().get('/ai-usage/summary?year=2099');
    check('sin token -> 401', r.status === 401, r.status);
    r = await http().get('/ai-usage/summary?year=2099').set(token('GH'));
    check('GH no puede consultar -> 403', r.status === 403, r.status);

    r = await http().get('/ai-usage/summary?year=2099').set(token('ADMIN'));
    const jan = r.body.months?.find((m) => m.month === 1);
    const feb = r.body.months?.find((m) => m.month === 2);
    check('resumen -> 200 en USD', r.status === 200 && r.body.currency === 'USD', r.body);
    check('31-ene 9 p.m. hora Colombia cuenta en enero', jan?.calls === 1 && jan?.costUsd === 0.0002, jan);
    check('febrero: 2 llamadas, $0.001, 2 modelos', feb?.calls === 2 && feb?.costUsd === 0.001 && feb?.byModel.length === 2, feb);
    check('total del año', r.body.total.calls === 3 && r.body.total.costUsd === 0.0012 && r.body.total.totalTokens === 3600, r.body.total);

    r = await http().get('/ai-usage?from=2099-02-01&to=2099-02-28').set(token('SUPERADMIN'));
    check('detalle de febrero (hora Colombia): 2 llamadas con usuario', r.status === 200 && r.body.length === 2 && r.body[0].user?.id === user!.id && typeof r.body[0].costUsd === 'number', r.body);
    r = await http().get('/ai-usage?from=2099-02-28&to=2099-02-01').set(token('ADMIN'));
    check('rango invertido -> 400', r.status === 400, r.body);
    r = await http().get('/ai-usage/summary?year=1999').set(token('ADMIN'));
    check('año inválido -> 400', r.status === 400, r.body);

    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token').build());
    const ops = Object.keys(doc.paths).filter((p) => p.startsWith('/ai-usage')).flatMap((p) => Object.values(doc.paths[p]) as any[]);
    check('swagger: 2 operaciones con tag, bearer y summary', ops.length === 2 && ops.every((o) => o.tags?.[0] === 'AI usage' && o.security?.[0]?.['access-token'] && o.summary));
  } finally {
    await prisma.aiUsageLog.deleteMany({ where: { id: { in: ids } } });
    const [value, called] = before.split('/');
    await prisma.$queryRawUnsafe(`SELECT setval('"AiUsageLog_id_seq"', ${Number(value)}, ${called === 'true'})`);
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
