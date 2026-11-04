// Prueba manual de los contratos (expuestos en /worker/:id/contracts) contra la BD del .env.
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
import { WorkerModule } from 'src/worker/worker.module';
import { WorkerContractService } from 'src/worker-contract/worker-contract.service';
import { addColombianDays, formatColombianISODate, getColombianToday } from 'src/common/utils/dateColombia';

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
    imports: [ConfigModule.forRoot({ isGlobal: true }), PrismaModule, WorkerModule],
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
  const token = (role: string) => ({ Authorization: `Bearer ${jwt.sign({ ...base, role })}` });
  const gh = token('GH');
  const admin = token('ADMIN');
  const superadmin = token('SUPERADMIN');
  const reception = token('RECEPTION');
  const http = () => request(app.getHttpServer());
  const stamp = Date.now().toString().slice(-8);
  const site = user!.id_site ?? 1;
  const today = getColombianToday();
  const iso = (offset: number) => formatColombianISODate(addColombianDays(today, offset));

  const company = await prisma.company.create({ data: { name: `EMP PRUEBA ${stamp}`, nit: `7${stamp}`, id_user: user!.id } });
  const inactiveCompany = await prisma.company.create({
    data: { name: `EMP INACTIVA ${stamp}`, nit: `8${stamp}`, id_user: user!.id, status: 'INACTIVE' },
  });
  const mk = (suffix: string, extra: any = {}) =>
    prisma.worker.create({ data: { dni: `${suffix}${stamp}`, name: `PRUEBA CONTRATOS ${suffix}`, id_user: user!.id, id_site: site, ...extra } });
  const worker = await mk('T');
  const indef = await mk('I');
  const appr = await mk('A');
  const alert1 = await mk('X');
  const alert2 = await mk('Y');
  const alert3 = await mk('Z');
  const yearly = await mk('F');
  const relocated = await mk('L');
  const retired = await mk('R', { status: 'DEACTIVATED', dateRetierment: new Date('2025-05-31T00:00:00.000Z') });
  const retiredNoDate = await mk('N', { status: 'DEACTIVATED' });
  const toReactivate = await mk('V', { status: 'DEACTIVATED', dateRetierment: new Date('2025-05-31T00:00:00.000Z') });
  const testWorkerIds = [worker, indef, appr, alert1, alert2, alert3, yearly, relocated, retired, retiredNoDate, toReactivate].map((w) => w.id);

  try {
    const url = (id: number) => `/worker/${id}/contracts`;
    const body = (extra: any = {}) => ({
      id_company: company.id, contractType: 'OBRA_LABOR', startDate: '2026-01-01', endDate: '2026-06-30', workerType: 'OPERATIVE', ...extra,
    });

    // ── Fecha calculada por modalidad ──
    const endDate = async (q: string) => (await http().get(`/worker/contracts/end-date?${q}`).set(gh));
    let r = await endDate('contractType=FIXED_13_WEEKS&startDate=2026-07-01');
    check('13 semanas: vence 2026-09-29, termina 2026-09-27 (2 días antes)',
      r.body.stipulatedEndDate === '2026-09-29' && r.body.suggestedEndDate === '2026-09-27' && r.body.terminationDaysBefore === 2, r.body);
    r = await endDate('contractType=FIXED_3_MONTHS&startDate=2026-07-01');
    check('3 meses: vence 2026-09-30, termina 2026-09-29 (1 día antes)',
      r.body.stipulatedEndDate === '2026-09-30' && r.body.suggestedEndDate === '2026-09-29' && r.body.terminationDaysBefore === 1, r.body);
    r = await endDate('contractType=FIXED_3_MONTHS&startDate=2026-01-31');
    check('3 meses desde 31-ene: vence 30-abr, termina 29-abr', r.body.suggestedEndDate === '2026-04-29', r.body);
    r = await endDate('contractType=APPRENTICESHIP&startDate=2026-07-01');
    check('aprendizaje por defecto 6 meses -> 2026-12-31 (máx 2027-06-30)', r.body.suggestedEndDate === '2026-12-31' && r.body.maxEndDate === '2027-06-30', r.body);
    r = await endDate('contractType=APPRENTICESHIP&startDate=2026-07-01&months=12');
    check('aprendizaje 12 meses -> 2027-06-30', r.body.suggestedEndDate === '2027-06-30', r.body);
    r = await endDate('contractType=OBRA_LABOR&startDate=2026-07-01');
    check('obra labor sin vencimiento: sin cálculo, máximo 1 año - 2 días', r.body.suggestedEndDate === null && r.body.maxEndDate === '2027-06-28', r.body);
    r = await endDate('contractType=OBRA_LABOR&startDate=2026-07-01&stipulatedEndDate=2026-12-15');
    check('obra labor: vence 2026-12-15, termina 2026-12-13', r.body.suggestedEndDate === '2026-12-13', r.body);
    r = await endDate('contractType=OBRA_LABOR&startDate=2026-07-01&stipulatedEndDate=2027-07-15');
    check('obra labor de más de 1 año -> 400', r.status === 400, r.body);
    r = await endDate('contractType=FIXED_13_WEEKS&startDate=2026-07-01&stipulatedEndDate=2026-12-15');
    check('stipulatedEndDate en otra modalidad -> 400', r.status === 400, r.body);
    r = await endDate('contractType=FIXED_1_YEAR&startDate=2026-07-01');
    check('1 año: vence 2027-06-30, termina 2027-06-28 (2 días antes)',
      r.body.stipulatedEndDate === '2027-06-30' && r.body.suggestedEndDate === '2027-06-28' && r.body.terminationDaysBefore === 2, r.body);
    r = await endDate('contractType=FIXED_1_YEAR&startDate=2026-07-01&stipulatedEndDate=2028-06-30');
    check('1 año no acepta vencimiento estipulado -> 400', r.status === 400, r.body);
    r = await endDate('contractType=INDEFINITE&startDate=2026-07-01');
    check('indefinido: sin fecha de terminación', r.body.suggestedEndDate === null && r.body.endDateRequired === false, r.body);
    r = await endDate('contractType=FIXED_3_MONTHS&startDate=2026-07-01&months=6');
    check('months en otra modalidad -> 400', r.status === 400, r.body);

    // ── Validaciones de registro ──
    r = await http().post(url(worker.id)).send(body());
    check('sin token -> 401', r.status === 401, r.status);
    r = await http().post(url(worker.id)).set(reception).send(body());
    check('RECEPTION no puede crear -> 403', r.status === 403, r.status);

    let s = await seq(prisma, 'WorkerContract');
    r = await http().post(url(worker.id)).set(gh).send(body({ contractType: undefined }));
    check('contractType obligatorio -> 400', r.status === 400, r.body);
    r = await http().post(url(worker.id)).set(gh).send(body({ endDate: undefined }));
    check('obra labor sin endDate -> 400', r.status === 400, r.body);
    r = await http().post(url(worker.id)).set(gh).send(body({ endDate: '2027-01-15' }));
    check('obra labor de más de 1 año -> 400', r.status === 400, r.body);
    r = await http().post(url(worker.id)).set(gh).send(body({ contractType: 'FIXED_13_WEEKS', endDate: '2026-04-15' }));
    check('13 semanas más largo de lo permitido -> 400', r.status === 400, r.body);
    r = await http().post(url(worker.id)).set(gh).send(body({ id_company: inactiveCompany.id }));
    check('empresa inactiva -> 400', r.status === 400, r.body);
    r = await http().post(url(worker.id)).set(gh).send(body({ id_company: 999999 }));
    check('empresa inexistente -> 404', r.status === 404 && /Company/.test(r.body.message), r.body);
    r = await http().post(url(99999999)).set(gh).send(body());
    check('trabajador inexistente -> 404', r.status === 404 && /Worker/.test(r.body.message), r.body);
    check('los errores no consumen id', (await seq(prisma, 'WorkerContract')) === s);

    // ── Registro, cruces, historial ──
    r = await http().post(url(worker.id)).set(gh).send(body());
    check('crea obra labor -> 201', r.status === 201 && r.body.contractType === 'OBRA_LABOR' && r.body.company?.id === company.id, r.body);
    const c1 = r.body;
    let w = await prisma.worker.findUnique({ where: { id: worker.id } });
    check('dateRetierment = fin del contrato', day(w!.dateRetierment) === '2026-06-30', w!.dateRetierment);

    s = await seq(prisma, 'WorkerContract');
    r = await http().post(url(worker.id)).set(gh).send(body({ startDate: '2026-06-15', endDate: '2026-12-31' }));
    check('contrato que se cruza -> 409 sin consumir id', r.status === 409 && (await seq(prisma, 'WorkerContract')) === s, r.body);

    r = await http().post(url(worker.id)).set(gh).send(body({ contractType: 'FIXED_13_WEEKS', startDate: '2026-07-01', endDate: undefined }));
    check('13 semanas sin endDate usa la terminación calculada (2026-09-27)', r.status === 201 && day(r.body.endDate) === '2026-09-27', r.body);
    const c2 = r.body;
    r = await http().post(url(worker.id)).set(gh).send(body({ contractType: 'FIXED_3_MONTHS', startDate: '2026-12-01', endDate: '2027-02-28' }));
    check('3 meses terminando el día del vencimiento (se renovaría solo) -> 400', r.status === 400, r.body);

    r = await http().get(url(worker.id)).set(reception);
    check('historial ordenado (más reciente primero)', r.status === 200 && r.body[0]?.id === c2.id && r.body[1]?.id === c1.id, r.body);
    r = await http().get(`${url(worker.id)}/current?date=2026-03-15`).set(gh);
    check('vigente el 2026-03-15 = obra labor', r.body.id === c1.id, r.body);

    r = await http().patch(`${url(worker.id)}/${c2.id}`).set(gh).send({ endDate: '2026-10-15' });
    check('extender un fijo más allá de su máximo -> 400 (usar renovación)', r.status === 400, r.body);
    r = await http().patch(`${url(worker.id)}/${c1.id}`).set(gh).send({ endDate: '2026-07-15' });
    check('editar fin para cruzarse -> 409', r.status === 409, r.body);
    r = await http().patch(`${url(worker.id)}/${c1.id}`).set(gh).send({ endDate: '2026-06-20' });
    check('terminar antes un contrato -> 200', r.status === 200 && day(r.body.endDate) === '2026-06-20', r.body);
    r = await http().patch(`${url(retired.id)}/${c1.id}`).set(gh).send({ endDate: '2026-06-21' });
    check('contrato de otro trabajador en la ruta -> 404', r.status === 404, r.body);

    // ── Renovación ──
    r = await http().post(`${url(worker.id)}/${c2.id}/renew`).set(gh).send({});
    check('renovar 13 semanas: inicia 2026-09-28 y termina 2026-12-25', r.status === 201 && day(r.body.startDate) === '2026-09-28' && day(r.body.endDate) === '2026-12-25' && r.body.contractType === 'FIXED_13_WEEKS', r.body);
    const c3 = r.body;
    r = await http().post(`${url(worker.id)}/${c2.id}/renew`).set(gh).send({});
    check('renovar dos veces el mismo contrato -> 409 (se cruza)', r.status === 409, r.body);

    // ── Definido de 1 año ──
    // ── Trabajador reubicado: contrato vigente sin fecha de terminación ──
    r = await http().post(url(relocated.id)).set(gh).send(body({ contractType: 'FIXED_1_YEAR', startDate: '2017-03-20', endDate: undefined, isRelocated: true }));
    const cl = r.body;
    check('reubicado: contrato de 2017 vigente sin terminación', r.status === 201 && cl.isRelocated === true && cl.endDate === null, r.body);
    r = await http().get(`${url(relocated.id)}/current`).set(gh);
    check('reubicado: es el contrato vigente hoy', r.body.id === cl.id, r.body);
    const expiringRelocated = await service.findExpiring(36500);
    check('reubicado: no aparece en contratos por terminar', Array.isArray(expiringRelocated) && !expiringRelocated.some((c) => c.id === cl.id));
    r = await http().post(url(relocated.id)).set(gh).send(body({ contractType: 'FIXED_1_YEAR', startDate: '2020-01-01', endDate: undefined, isRelocated: true }));
    check('reubicado: otro contrato se cruza -> 409', r.status === 409, r.body);
    r = await http().post(url(appr.id)).set(gh).send(body({ contractType: 'APPRENTICESHIP', startDate: '2030-01-01', endDate: undefined, isRelocated: true }));
    check('reubicado: no aplica a aprendizaje -> 400', r.status === 400, r.body);
    r = await http().post(url(appr.id)).set(gh).send(body({ contractType: 'FIXED_1_YEAR', startDate: '2030-01-01', endDate: '2030-06-01', isRelocated: true }));
    check('reubicado: no acepta terminación al registrar -> 400', r.status === 400, r.body);
    r = await http().post(`${url(relocated.id)}/${cl.id}/renew`).set(gh).send({});
    check('reubicado: sin terminación no se renueva -> 409', r.status === 409, r.body);
    r = await http().patch(`${url(relocated.id)}/${cl.id}`).set(gh).send({ endDate: '2026-10-01' });
    check('reubicado: se cierra con terminación aunque supere 1 año', r.status === 200 && day(r.body.endDate) === '2026-10-01' && r.body.isRelocated === true, r.body);
    r = await http().patch(`${url(relocated.id)}/${cl.id}`).set(gh).send({ isRelocated: false });
    check('reubicado: quitar la marca con terminación mayor a 1 año -> 400', r.status === 400, r.body);
    await prisma.workerContract.update({ where: { id: cl.id }, data: { isRelocated: false, endDate: new Date('2018-03-18T00:00:00.000Z') } });
    r = await http().patch(`${url(relocated.id)}/${cl.id}`).set(gh).send({ isRelocated: true });
    check('reubicado: marcar un contrato existente quita la terminación', r.status === 200 && r.body.isRelocated === true && r.body.endDate === null, r.body);
    r = await http().post(url(yearly.id)).set(gh).send(body({ contractType: 'FIXED_1_YEAR', startDate: '2026-07-01', endDate: undefined }));
    check('registra 1 año sin endDate: termina 2027-06-28', r.status === 201 && day(r.body.endDate) === '2027-06-28', r.body);
    const cy = r.body;
    r = await http().post(url(yearly.id)).set(gh).send(body({ contractType: 'FIXED_1_YEAR', startDate: '2028-01-01', endDate: '2029-06-30' }));
    check('1 año con terminación mayor a 1 año -> 400', r.status === 400, r.body);
    r = await http().post(`${url(yearly.id)}/${cy.id}/renew`).set(gh).send({});
    check('renovar 1 año: inicia 2027-06-29 y termina 2028-06-26', r.status === 201 && day(r.body.startDate) === '2027-06-29' && day(r.body.endDate) === '2028-06-26', r.body);

    // ── Indefinido ──
    r = await http().post(url(indef.id)).set(gh).send(body({ contractType: 'INDEFINITE', startDate: '2026-01-01', endDate: '2026-12-31' }));
    check('indefinido con endDate -> 400', r.status === 400, r.body);
    r = await http().post(url(indef.id)).set(gh).send(body({ contractType: 'INDEFINITE', startDate: '2026-01-01', endDate: undefined }));
    check('indefinido sin endDate -> 201', r.status === 201 && r.body.endDate === null, r.body);
    const ci = r.body;
    w = await prisma.worker.findUnique({ where: { id: indef.id } });
    check('indefinido: dateRetierment vacío', w!.dateRetierment === null, w!.dateRetierment);
    r = await http().get(`${url(indef.id)}/current?date=2030-01-01`).set(gh);
    check('indefinido sigue vigente en 2030', r.body.id === ci.id, r.body);
    r = await http().post(url(indef.id)).set(gh).send(body({ startDate: '2028-01-01', endDate: '2028-06-30' }));
    check('contrato posterior a un indefinido abierto -> 409', r.status === 409, r.body);
    r = await http().post(`${url(indef.id)}/${ci.id}/renew`).set(gh).send({});
    check('renovar un indefinido -> 409', r.status === 409, r.body);
    r = await http().patch(`${url(indef.id)}/${ci.id}`).set(gh).send({ endDate: '2026-11-30' });
    w = await prisma.worker.findUnique({ where: { id: indef.id } });
    check('cerrar el indefinido con su terminación', r.status === 200 && day(w!.dateRetierment) === '2026-11-30', r.body);

    // ── Aprendizaje ──
    r = await http().post(url(appr.id)).set(gh).send(body({ contractType: 'APPRENTICESHIP', startDate: '2026-07-01', endDate: '2026-11-30' }));
    check('aprendizaje de menos de 6 meses -> 400', r.status === 400, r.body);
    r = await http().post(url(appr.id)).set(gh).send(body({ contractType: 'APPRENTICESHIP', startDate: '2026-07-01', endDate: undefined, months: 12 }));
    check('aprendizaje de 12 meses -> 201 (2027-06-30)', r.status === 201 && day(r.body.endDate) === '2027-06-30', r.body);
    const ca = r.body;
    r = await http().patch(`${url(appr.id)}/${ca.id}`).set(admin).send({ endDate: '2027-09-30' });
    check('ADMIN no puede extender un aprendizaje -> 403', r.status === 403, r.body);
    r = await http().patch(`${url(appr.id)}/${ca.id}`).set(gh).send({ endDate: '2027-09-30' });
    check('GH extiende el aprendizaje más allá de 1 año -> 200', r.status === 200 && day(r.body.endDate) === '2027-09-30', r.body);

    // ── Alertas por modalidad ──
    await http().post(url(alert1.id)).set(gh).send(body({ contractType: 'FIXED_3_MONTHS', startDate: iso(-60), endDate: iso(1) }));
    await http().post(url(alert2.id)).set(gh).send(body({ contractType: 'FIXED_3_MONTHS', startDate: iso(-60), endDate: iso(2) }));
    await http().post(url(alert3.id)).set(gh).send(body({ contractType: 'OBRA_LABOR', startDate: iso(-60), endDate: iso(2) }));
    r = await http().get('/worker/contracts/expiring').set(gh);
    const alertWorkers = Array.isArray(r.body) ? r.body.map((c) => c.id_worker) : [];
    check('por terminar (30 días por defecto) incluye los 3', [alert1.id, alert2.id, alert3.id].every((id) => alertWorkers.includes(id)), r.body);
    check('contrato con renovación posterior no aparece', !alertWorkers.includes(worker.id));
    r = await http().get('/worker/contracts/expiring?days=1').set(gh);
    const nextDay = Array.isArray(r.body) ? r.body.map((c) => c.id_worker) : [];
    check('days=1: solo el que termina mañana', nextDay.includes(alert1.id) && !nextDay.includes(alert2.id) && !nextDay.includes(alert3.id), r.body);

    const err = await service.applyRetirementDate(prisma, worker.id, new Date('2026-11-01T00:00:00.000Z'));
    const c3db = await prisma.workerContract.findUnique({ where: { id: c3.id } });
    check('desactivar el 2026-11-01 cierra el contrato en esa fecha', !err && day(c3db!.endDate) === '2026-11-01', { err, c3db });

    // ── Trabajador DEACTIVATED: solo contratos históricos y nunca se reactiva ──
    s = await seq(prisma, 'WorkerContract');
    r = await http().post(url(retired.id)).set(gh).send(body({ startDate: iso(-30), endDate: iso(0) }));
    check('inactivo: contrato que termina hoy -> 409', r.status === 409, r.body);
    r = await http().post(url(retired.id)).set(gh).send(body({ startDate: '2025-01-01', endDate: '2025-06-30' }));
    check('inactivo: termina después del retiro -> 409', r.status === 409, r.body);
    r = await http().post(url(retired.id)).set(gh).send(body({ contractType: 'INDEFINITE', startDate: '2025-01-01', endDate: undefined }));
    check('inactivo: indefinido abierto -> 409', r.status === 409, r.body);
    check('inactivo: los rechazos no consumen id', (await seq(prisma, 'WorkerContract')) === s);
    r = await http().post(url(retired.id)).set(gh).send(body({ startDate: '2025-01-01', endDate: '2025-05-31' }));
    check('inactivo: contrato histórico -> 201', r.status === 201, r.body);
    let rw = await prisma.worker.findUnique({ where: { id: retired.id } });
    check('inactivo: sigue DEACTIVATED y conserva su retiro', rw!.status === 'DEACTIVATED' && day(rw!.dateRetierment) === '2025-05-31', rw);

    r = await http().post(url(retiredNoDate.id)).set(gh).send(body({ startDate: iso(-200), endDate: iso(-1) }));
    rw = await prisma.worker.findUnique({ where: { id: retiredNoDate.id } });
    check('inactivo sin fecha: histórico, sigue DEACTIVATED y toma la fecha del contrato', r.status === 201 && rw!.status === 'DEACTIVATED' && day(rw!.dateRetierment) === iso(-1), rw);

    // ── Reactivar por PATCH /worker exige el contrato ──
    s = await seq(prisma, 'WorkerContract');
    r = await http().patch(`/worker/${toReactivate.id}`).set(gh).send({ status: 'AVALIABLE' });
    check('reactivar sin contrato -> 400', r.status === 400, r.body);
    r = await http().patch(`/worker/${toReactivate.id}`).set(gh).send({ status: 'AVALIABLE', contract: body({ startDate: '2025-05-01', endDate: '2025-12-31' }) });
    check('reactivar con contrato que inicia antes del retiro -> 409', r.status === 409, r.body);
    r = await http().patch(`/worker/${worker.id}`).set(gh).send({ name: 'PRUEBA CONTRATOS T', contract: body() });
    check('contrato en una edición que no reactiva -> 400', r.status === 400, r.body);
    check('reactivación rechazada: sigue DEACTIVATED y no consume id',
      (await prisma.worker.findUnique({ where: { id: toReactivate.id } }))!.status === 'DEACTIVATED' && (await seq(prisma, 'WorkerContract')) === s);
    r = await http().patch(`/worker/${toReactivate.id}`).set(gh).send({
      status: 'AVALIABLE', contract: body({ contractType: 'INDEFINITE', startDate: iso(-10), endDate: undefined }),
    });
    const hist = await prisma.workerContract.findMany({ where: { id_worker: toReactivate.id }, orderBy: { id: 'asc' } });
    check('reactivar con contrato -> AVALIABLE + contrato', r.status === 200 && r.body.status === 'AVALIABLE' && r.body.contract?.contractType === 'INDEFINITE', r.body);
    check('reactivar conserva el retiro anterior como histórico', hist.length === 2 && hist[0].isLegacy && day(hist[0].endDate) === '2025-05-31', hist);

    // ── Crear trabajador por POST /worker exige el contrato ──
    const area = await prisma.jobArea.findFirst({ where: { id_site: site } });
    const newWorker = (extra: any = {}) => ({
      dni: `W${stamp}`, code: `C${stamp}`, payroll_code: `P${stamp}`, phone: `9${stamp}`, name: 'PRUEBA CONTRATOS NUEVO',
      status: 'AVALIABLE', id_area: area!.id, ...extra,
    });
    s = await seq(prisma, 'WorkerContract');
    const sWorker = await seq(prisma, 'Worker');
    r = await http().post('/worker').set(superadmin).send(newWorker());
    check('crear trabajador sin contrato -> 400', r.status === 400, r.body);
    r = await http().post('/worker').set(superadmin).send(newWorker({ contract: body({ endDate: '2027-06-30' }) }));
    check('crear trabajador con contrato inválido -> 400 sin consumir ids', r.status === 400 && (await seq(prisma, 'Worker')) === sWorker && (await seq(prisma, 'WorkerContract')) === s, r.body);
    r = await http().post('/worker').set(superadmin).send(newWorker({ contract: body({ contractType: 'FIXED_3_MONTHS', startDate: iso(0), endDate: undefined }) }));
    check('crear trabajador con contrato -> 201 con su contrato', r.status === 201 && r.body.contract?.contractType === 'FIXED_3_MONTHS' && r.body.contract?.id_worker === r.body.id, r.body);
    if (r.body?.id) testWorkerIds.push(r.body.id);

    // ── Swagger ──
    const doc = SwaggerModule.createDocument(app, new DocumentBuilder().addBearerAuth({ type: 'http', scheme: 'bearer' }, 'access-token').build());
    const paths = Object.keys(doc.paths).filter((p) => p.includes('contracts'));
    const ops = paths.flatMap((p) => Object.values(doc.paths[p]) as any[]);
    check(`swagger: ${ops.length} operaciones de contratos en /worker con tag, bearer y summary`,
      ops.length === 8 && paths.every((p) => p.startsWith('/worker/')) &&
      ops.every((o) => o.tags?.includes('Worker contracts') && o.security?.[0]?.['access-token'] && o.summary), paths);
  } finally {
    await prisma.workerContract.deleteMany({ where: { id_worker: { in: testWorkerIds } } });
    await prisma.worker.deleteMany({ where: { id: { in: testWorkerIds } } });
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
