import { Injectable, UnprocessableEntityException } from '@nestjs/common';
import { Prisma, StatusOperation } from '@prisma/client';
import * as ExcelJS from 'exceljs';
import { BillService } from 'src/bill/bill.service';
import { PrismaService } from 'src/prisma/prisma.service';
import {ExportOperationsDto,ExportReportType,} from '../dto/export-operations.dto';

interface ExportScope {
	userId: number;
	siteId?: number;
	subsiteId?: number;
}


// Servicio principal para la exportación de operaciones a Excel
@Injectable()
export class OperationExportService {
	// private readonly MAX_OPERATIONS_PER_EXPORT = 20;
	// private readonly OPERATION_BATCH_SIZE = 500; //menejo de carga / lotes  

	constructor(
		private readonly prisma: PrismaService,
		private readonly billService: BillService,
	) {}

	// Metodo principal para exportar operaciones segun filtros y tipo de reporte
	async export(
		dto: ExportOperationsDto,
		scope: ExportScope,
	): Promise<{ buffer: Buffer; fileName: string } | { noContent: true }> {
		if (!scope.userId) {
			throw new UnprocessableEntityException('No fue posible identificar el usuario autenticado.');
		}

		const filters = this.normalizeFilters(dto);
		const where = this.buildWhere(filters, scope);
		const totalOperations = await this.prisma.operation.count({ where });

		// if (totalOperations > this.MAX_OPERATIONS_PER_EXPORT) {
		// 	throw new UnprocessableEntityException(
		// 		`La exportacion supera el maximo permitido (${this.MAX_OPERATIONS_PER_EXPORT} operaciones). Ajusta filtros.`,
		// 	);
		// }

		 // Variables para acumulación de datos y control de paginación
		const generalRows: any[] = [];
		const workerRows: any[] = [];
		const programmingOperations: any[] = [];
		let lastId: number | undefined;

         // Bucle para cargar operaciones en lotes y construir filas para el Excel
		while (true) {
			const batchWhere: Prisma.OperationWhereInput = lastId
				? { AND: [where, { id: { lt: lastId } }] }
				: where;
            // Consulta para obtener un lote de operaciones con sus relaciones necesarias para el reporte
			const operations = await this.prisma.operation.findMany({
				where: batchWhere,
				// take: this.OPERATION_BATCH_SIZE,
				select: {
					id: true,
					status: true,
					dateStart: true,
					dateEnd: true,
					timeStrat: true,
					timeEnd: true,
					motorShip: true,
					subSite: { select: { id: true, name: true } },
					jobArea: { select: { id: true, name: true } },
					client: { select: { id: true, name: true } },
					inChargeOperation: {
						select: {
							id_user: true,
							user: { select: { id: true, name: true, username: true } },
						},
					},
					workers: {
						select: {
							id: true,
							id_operation: true,
							id_worker: true,
							id_group: true,
							dateStart: true,
							dateEnd: true,
							timeStart: true,
							timeEnd: true,
							SubTask: { select: { id: true, code: true, name: true } },
							tariff: {
								select: {
									unitOfMeasure: { select: { id: true, name: true } },
								},
							},
							worker: {
								select: {
									id: true,
									name: true,
									dni: true,
									payroll_code: true,
								},
							},
						},
					},
				},
				orderBy: { id: 'desc' },
			});

			if (!operations.length) break;

			if (dto.reportType === ExportReportType.NORMAL) {
				programmingOperations.push(...operations);
				lastId = operations[operations.length - 1].id;
				continue;
			}

           // Obtener IDs de operaciones del lote actual para consultas relacionadas (bills, feedings)
			const operationIds = operations.map((o) => o.id);
			const [bills, feedings] = await Promise.all([
				this.billService.findByOperationIdsWithCompensatory(operationIds, {
					siteId: scope.siteId,
					subsiteId: scope.subsiteId,
				}),
				this.prisma.workerFeeding.findMany({
					where: { id_operation: { in: operationIds } },
					select: {
						id_operation: true,
						id_worker: true,
					},
				}),
			]);

			generalRows.push(
				...this.buildGeneralRows(operations, bills, feedings, filters.timezone),
			);

			if (dto.reportType === ExportReportType.WORKER) {
				workerRows.push(
					...this.buildWorkerRows(operations, bills, feedings, filters.timezone),
				);
			}

			lastId = operations[operations.length - 1].id;
		}

		if (dto.reportType === ExportReportType.NORMAL) {
			if (!programmingOperations.length) {
				return { noContent: true };
			}
			return this.exportProgramming(programmingOperations);
		}

		const hasGeneralRows = generalRows.length > 0;
		const hasWorkerRows =
			dto.reportType !== ExportReportType.WORKER || workerRows.length > 0;

		if (!hasGeneralRows || !hasWorkerRows) {
			return { noContent: true };
		}

		const workbook = new ExcelJS.Workbook();
		workbook.creator = 'PlannerWeb';
		workbook.created = new Date();

		this.addSheet(workbook, 'reporte-general', generalRows, true);
		if (dto.reportType === ExportReportType.WORKER) {
			this.addSheet(workbook, 'reporte-trabajador', workerRows, false);
		}

		const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
		const fileName = `operaciones_${new Date().toISOString().slice(0, 10)}.xlsx`;

		return { buffer, fileName };
	}




	//(PROGRAMACION)programa de operaciones: reporte simplificado con una fila por operacion
	async exportProgramming(operations: any[]): Promise<{ buffer: Buffer; fileName: string }> {
		const workbook = new ExcelJS.Workbook();
		workbook.creator = 'PlannerWeb';
		workbook.created = new Date();

		const generalRows = this.buildProgrammingGeneralRows(operations);
		const detailRows = this.buildProgrammingDetailRows(operations);

		this.addProgrammingSheet(
			workbook,
			'reporte-general',
			'Reporte de Operaciones - Todas las areas - Finalizado - Resumen General',
			generalRows,
			[
				{ label: 'Total operaciones', value: generalRows.length },
				{ label: 'Completadas', value: generalRows.filter((r) => r.Estado === 'Finalizado').length },
				{ label: 'En curso', value: generalRows.filter((r) => r.Estado === 'En Curso').length },
				{ label: 'Pendientes', value: generalRows.filter((r) => r.Estado === 'Pendiente').length },
				{ label: 'Canceladas', value: generalRows.filter((r) => r.Estado === 'Cancelado').length },
			],
		);

		this.addProgrammingSheet(
			workbook,
			'reporte-trabajador',
			'Reporte de Operaciones - Todas las areas - Finalizado - Detalle por Trabajadores',
			detailRows,
			[
				{ label: 'Total operaciones', value: new Set(detailRows.map((r) => r.Operacion)).size },
				{ label: 'Total trabajadores', value: detailRows.filter((r) => Number(r['DNI Trabajador']) > 0).length },
				{ label: 'Registros', value: detailRows.length },
			],
		);

		const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
		const fileName = `programacion_${new Date().toISOString().slice(0, 10)}.xlsx`;
		return { buffer, fileName };
	}


	// Metodos auxiliares para normalización de filtros, construcción de condiciones de consulta, agrupaci0n de datos y formateo para el Excel
	private normalizeFilters(dto: ExportOperationsDto) {
		const f = dto.filters || {};

		const dateStart = f.dateStart ? this.toUtcStartOfDay(f.dateStart) : undefined;
		const dateEnd = f.dateEnd ? this.toUtcEndOfDay(f.dateEnd) : undefined;

		if (dateStart && dateEnd && dateEnd.getTime() < dateStart.getTime()) {
			throw new UnprocessableEntityException('dateEnd no puede ser menor que dateStart.');
		}

		return {
			dateStart,
			dateEnd,
			status: f.status?.length ? f.status : undefined,
			jobAreaIds: f.jobAreaIds?.length ? f.jobAreaIds : undefined,
			inChargedId: f.inChargedId,
			search: f.search?.trim() || undefined,
			excludeCanceled: f.excludeCanceled ?? true,
			timezone: f.timezone || 'America/Bogota',
		};
	}
  
	//Construcción din4mica de la condición "where" para la consulta de operaciones según los filtros y el alcance (site/subsite)
	private buildWhere(
		filters: {
			dateStart?: Date;
			dateEnd?: Date;
			status?: string[];
			jobAreaIds?: number[];
			inChargedId?: number;
			search?: string;
			excludeCanceled: boolean;
			timezone: string;
		},
		scope: ExportScope,
	): Prisma.OperationWhereInput {
		const where: Prisma.OperationWhereInput = {};
		const and: Prisma.OperationWhereInput[] = [];

		if (filters.dateStart && filters.dateEnd) {
			and.push({ dateStart: { gte: filters.dateStart, lte: filters.dateEnd } });
		} else if (filters.dateStart) {
			and.push({ dateStart: { gte: filters.dateStart } });
		} else if (filters.dateEnd) {
			and.push({ dateStart: { lte: filters.dateEnd } });
		}
		if (and.length) where.AND = and;

		if (typeof scope.siteId === 'number') where.id_site = scope.siteId;
		if (typeof scope.subsiteId === 'number') where.id_subsite = scope.subsiteId;

		if (filters.status?.length) {
			const validStatuses = filters.status.filter((s) =>
				Object.values(StatusOperation).includes(s as StatusOperation),
			) as StatusOperation[];

			if (validStatuses.length) where.status = { in: validStatuses };
		} else {
    where.status = StatusOperation.COMPLETED;  //descargar SOLO OpFinalizadas
      }  

		if (filters.jobAreaIds?.length) where.id_area = { in: filters.jobAreaIds };

		if (filters.inChargedId) {
			where.inChargeOperation = { some: { id_user: filters.inChargedId } };
		}

		if (filters.search) {
			const text = filters.search;
			const numeric = Number(text);
			const orConditions: Prisma.OperationWhereInput[] = [
				{ client: { name: { contains: text, mode: 'insensitive' } } },
				{ jobArea: { name: { contains: text, mode: 'insensitive' } } },
				{ motorShip: { contains: text, mode: 'insensitive' } },
				{
					workers: {
						some: {
							OR: [
								{ SubTask: { name: { contains: text, mode: 'insensitive' } } },
								{ SubTask: { code: { contains: text, mode: 'insensitive' } } },
							],
						},
					},
				},
			];
			if (Number.isInteger(numeric)) orConditions.push({ id: numeric });
			where.OR = orConditions;
		}

		return where;
	}

	// (RTD) (HOJA 1)Funciones de normalización para manejar tanto arrays como strings separados por comas
	private buildGeneralRows(
		operations: any[],
		bills: any[],
		feedings: any[],
		timezone: string,
	) {
		const billsByOperation = new Map<number, any[]>();
		const feedingsByOperation = new Map<number, number>();

		for (const bill of bills) {
			const list = billsByOperation.get(bill.id_operation) || [];
			list.push(bill);
			billsByOperation.set(bill.id_operation, list);
		}

		for (const feeding of feedings) {
			feedingsByOperation.set(
				feeding.id_operation,
				(feedingsByOperation.get(feeding.id_operation) || 0) + 1,
			);
		}

		const rows: any[] = [];

		for (const op of operations) {
			const opBills = billsByOperation.get(op.id) || [];
			const workersByGroup = this.groupWorkersByIdGroup(op.workers || []);

			if (!workersByGroup.length) {
				rows.push({
					"Operacion": op.id,
					"Fecha Inicio Op.": this.combineDateTime(op.dateStart, op.timeStrat),
					"Fecha Fin Op.": this.combineDateTime(op.dateEnd, op.timeEnd),
					Semana: this.isoWeek(op.dateStart),
					"Codigo Subservicio": 0,
					Subservicio: 'Sin subservicio',
					"Unidad de Medida": '',
					Cantidad: this.round2(opBills.reduce((acc, b) => acc + Number(b.amount || 0), 0)),
					"Horas Trabajadas Op.": this.hoursToDecimal(					
					this.getHoursWorked(op.dateStart, op.timeStrat, op.dateEnd, op.timeEnd)),
					"Total Trabajadores": 0,
					"Total Nomina": this.round2(opBills.reduce((acc, b) => acc + Number(b.total_paysheet || 0), 0)),
					Buque: op.motorShip || '',
					"Total Alimentacion": feedingsByOperation.get(op.id) || 0,
					"Supervisores": this.formatSupervisors(op.inChargeOperation),
					Observaciones: this.joinObservations(opBills),
					Subsede: op.subSite?.name || 'Sin subsede',
					"Area": op.jobArea?.name || 'Sin area',
					Cliente: op.client?.name || 'Sin cliente',
					Estado: this.statusLabel(op.status),
				});
				continue;
			}
            
			for (const group of workersByGroup) {
				const groupBills = opBills.filter((b: any) => String(b.id_group || '') === String(group.groupId || ''));
				const schedule = group.firstWorker;
				const quantity = this.groupQuantity(groupBills, group.workers.length, group.unitMeasure);
             
				 // EDITAR 
				rows.push({
					"Operacion": op.id,
					"Fecha Inicio Op.": this.combineDateTime(
						schedule.dateStart || op.dateStart,
						schedule.timeStart || op.timeStrat,
					),
					"Fecha Fin Op.": this.combineDateTime(
						schedule.dateEnd || op.dateEnd,
						schedule.timeEnd || op.timeEnd,
					),
					Semana: this.isoWeek(schedule.dateStart || op.dateStart),
					"Codigo Subservicio": Number(group.subserviceCode || 0),
					Subservicio: group.subserviceName || 'Sin subservicio',
					"Unidad de Medida": group.unitMeasure || '',
					Cantidad: this.round2(quantity),
					"Horas Trabajadas Op.": this.hoursToDecimal(
						this.getHoursWorked(
							schedule.dateStart || op.dateStart,
							schedule.timeStart || op.timeStrat,
							schedule.dateEnd || op.dateEnd,
							schedule.timeEnd || op.timeEnd,
						)
					),
					"Total Trabajadores": group.workers.length,
					"Total Nomina": this.round2(groupBills.reduce((acc: number, b: any) => acc + Number(b.total_paysheet || 0), 0)),
					Buque: op.motorShip || '',
				    "Total Alimentacion": feedingsByOperation.get(op.id) || 0,
					Supervisores: this.formatSupervisors(op.inChargeOperation),
					Observaciones: this.joinObservations(groupBills),
					Subsede: op.subSite?.name || 'Sin subsede',
					Area: op.jobArea?.name || 'Sin area',
					Cliente: op.client?.name || 'Sin cliente',
					Estado: this.statusLabel(op.status),
				});
			}
		}

		return rows;
	}
   
  // (RTD)  (HOJA 2) Reporte  detallado por trabajador, cada fila es un trabajador específico dentro de una operacion
	private buildWorkerRows(
		operations: any[],
		bills: any[],
		feedings: any[],
		timezone: string,
	) {
		const billsByOperation = new Map<number, any[]>();
		const feedingsByWorker = new Map<string, number>();

		for (const bill of bills) {
			const list = billsByOperation.get(bill.id_operation) || [];
			list.push(bill);
			billsByOperation.set(bill.id_operation, list);
		}

		for (const feeding of feedings) {
			const key = `${feeding.id_operation}-${feeding.id_worker}`;
			feedingsByWorker.set(key, (feedingsByWorker.get(key) || 0) + 1);
		}

		const rows: any[] = [];

		for (const op of operations) {
			const opBills = billsByOperation.get(op.id) || [];
            
			if (!op.workers?.length) {
				rows.push({
					"Operacion": op.id,
					Inicio: this.combineDateTime(op.dateStart, op.timeStrat),
					Fin: this.combineDateTime(op.dateEnd, op.timeEnd),
					Semana: this.isoWeek(op.dateStart),
					DNITrabajador: 0,
					"Codigo Nomina": 0,
					"Nombre Trabajador": 'Sin trabajadores',
					"Codigo Subservicio": 0,
					Subservicio: 'Sin subservicio',
					"Unidad Medida": '',
					"Unidad Pago": 0,
					"Horas Trabajadas": this.hoursToDecimal(this.getHoursWorked(op.dateStart, op.timeStrat, op.dateEnd, op.timeEnd)),
					Cantidad: 0,
					"Total Nomina": 0,
					COMP: 0,
					HOD: 0,
					HND: 0,
					HED: 0,
					HEN: 0,
					FHOD: 0,
					FHND: 0,
					FHED: 0,
					FHEN: 0,
					Buque: op.motorShip || '',
					"Total Alimentacion": 0,
					Area: op.jobArea?.name || 'Sin area',
					Cliente: op.client?.name || 'Sin cliente',
					Estado: this.statusLabel(op.status),
				});
				continue;
			}

			for (const ow of op.workers) {
				const groupBills = opBills.filter((b: any) => String(b.id_group || '') === String(ow.id_group || ''));

				const workerBillDetails = groupBills
					.flatMap((b: any) => b.billDetails.map((d: any) => ({ ...d, __bill: b })))
					.filter((d: any) => d.id_operation_worker === ow.id);
        
				const billMatchedByWorker = groupBills.find((bill: any) =>
					(bill.billDetails || []).some(
						(detail: any) => String(detail.operationWorker?.id_worker || '') === String(ow.id_worker || ''),
					),
				); // Buscar bill del grupo /trabajador actual para obtener su compensatorio específico, si existe
				const workerComp = Number(
					billMatchedByWorker?.compensatory?.hours ??
						groupBills[0]?.compensatory?.hours ??
						0,
				);

				const firstDetail = workerBillDetails[0];
				const firstBill = firstDetail?.__bill;
				const workerCountDiv = Math.max(1, Number(firstBill?.number_of_workers || 1));

				const totalNomina = workerBillDetails.reduce(
					(acc: number, d: any) => acc + Number(d.total_paysheet || 0),
					0,
				);

				const distribution = {
					HOD: this.round2(groupBills.reduce((acc: number, b: any) => acc + Number(b.HOD || 0) / Math.max(1, Number(b.number_of_workers || 1)), 0)),
					HND: this.round2(groupBills.reduce((acc: number, b: any) => acc + Number(b.HON || 0) / Math.max(1, Number(b.number_of_workers || 1)), 0)),
					HED: this.round2(groupBills.reduce((acc: number, b: any) => acc + Number(b.HED || 0) / Math.max(1, Number(b.number_of_workers || 1)), 0)),
					HEN: this.round2(groupBills.reduce((acc: number, b: any) => acc + Number(b.HEN || 0) / Math.max(1, Number(b.number_of_workers || 1)), 0)),
					FHOD: this.round2(groupBills.reduce((acc: number, b: any) => acc + Number(b.HFOD || 0) / Math.max(1, Number(b.number_of_workers || 1)), 0)),
					FHND: this.round2(groupBills.reduce((acc: number, b: any) => acc + Number(b.HFON || 0) / Math.max(1, Number(b.number_of_workers || 1)), 0)),
					FHED: this.round2(groupBills.reduce((acc: number, b: any) => acc + Number(b.HFED || 0) / Math.max(1, Number(b.number_of_workers || 1)), 0)),
					FHEN: this.round2(groupBills.reduce((acc: number, b: any) => acc + Number(b.HFEN || 0) / Math.max(1, Number(b.number_of_workers || 1)), 0)),
				};

				const feedKey = `${op.id}-${ow.id_worker}`;
				// const workedHours = firstBill.this.getHoursWorked(ow.dateStart || op.dateStart, ow.timeStart || op.timeStrat, ow.dateEnd || op.dateEnd, ow.timeEnd || op.timeEnd);
                
				const workedHours = this.getHoursWorked(
						ow.dateStart || op.dateStart,
						ow.timeStart || op.timeStrat,
						ow.dateEnd || op.dateEnd,
						ow.timeEnd || op.timeEnd,
						);

											//EDITAR 
				rows.push({
					"Operacion": op.id,
					Inicio: this.combineDateTime(
						ow.dateStart || op.dateStart,
						ow.timeStart || op.timeStrat,
					),
					Fin: this.combineDateTime(
						ow.dateEnd || op.dateEnd,
						ow.timeEnd || op.timeEnd,
					),
					Semana: this.isoWeek(ow.dateStart || op.dateStart),
					"DNI Trabajador": Number(ow.worker?.dni || 0),
					"Codigo Nomina": Number(ow.worker?.payroll_code || 0),
					"Nombre Trabajador": ow.worker?.name || '',
					"Codigo Subservicio": Number(ow.SubTask?.code || 0),
					Subservicio: ow.SubTask?.name || 'Sin subservicio',
					"Unidad de Medida": ow.tariff?.unitOfMeasure?.name || '',
					"Unidad de Pago": this.round2(workerBillDetails.reduce((acc: number, d: any) => acc + Number(d.pay_unit || 0), 0)),
					"Horas Trabajadas": this.hoursToDecimal(workedHours),
					Cantidad: this.round2(workerBillDetails.reduce((acc: number, d: any) => acc + Number(d.pay_rate || 0), 0)),
					"Total Nomina": this.round2(totalNomina),
					COMP:(workerComp),   //no redondear comp
					HOD: distribution.HOD,
					HND: distribution.HND,
					HED: distribution.HED,
				    HEN: distribution.HEN,
					FHOD: distribution.FHOD,
					FHND: distribution.FHND,
					FHED: distribution.FHED,
					FHEN: distribution.FHEN,
					Buque: op.motorShip || '',
					"Total Alimentacion": feedingsByWorker.get(feedKey) || 0,
					Area: op.jobArea?.name || 'Sin area',
					Cliente: op.client?.name || 'Sin cliente',
					Estado: this.statusLabel(op.status),
				});
			}
		}

		return rows;
	}

	// (RTD) agregar una hoja al workbook con formato para encabezados y filas
	private addSheet(
		workbook: ExcelJS.Workbook,
		name: string,
		rows: any[],
		normalBlueHeader: boolean,
	) {
		const sheet = workbook.addWorksheet(name, {
			pageSetup: { fitToPage: true, fitToHeight: 5, fitToWidth: 7 },
		});

		if (!rows.length) return;

		const headers = Object.keys(rows[0]); // Asumimos que todas las filas tienen las mismas claves para los encabezados
		const finalHeaderRow = sheet.addRow(headers);  // Primera fila con los encabezados
		const compIndex = headers.indexOf('COMP') + 1; // Índice de la columna COMP para formato específico
		const hourHeaders = new Set([
			'COMP',
			'HOD',
			'HND',
			'HED',
			'HEN',
			'FHOD',
			'FHND',
			'FHED',
			'FHEN',
		]);

		sheet.views = [{ state: 'frozen', ySplit: 1 }];

		this.applyHeaderStyle(finalHeaderRow, '4472C4', 12, normalBlueHeader, hourHeaders);

		this.applyBodyRows(
			sheet, rows, headers, 2,
			new Set(['Subservicio','Observaciones','Supervisores','Buque','Subsede','Area','Cliente','Estado','Nombre Trabajador','Unidad de Medida','Unidad Medida']),
			new Set(['Operacion ','Semana','Inicio Op. ','Fin Op. ']),
		);

		if (compIndex > 0) sheet.getColumn(compIndex).numFmt = '#,##0.00';

		this.applyColumnFormats(sheet, headers, {
			dateTimeHeaders: new Set(['Fecha Inicio Op.',
  'Fecha Fin Op.',
  'Inicio',
  'Fin',
  'Fecha Inicio',
  'Fecha Fin']),
			decimalHeaders: new Set([
				'Cantidad',
				'Total Nomina',
				'Unidad de Pago',
				'Unidad Pago',
				'COMP',
				'HOD',
				'HND',
				'HED',
				'HEN',
				'FHOD',
				'FHND',
				'FHED',
				'FHEN',
				'Horas Trabajadas Op.',
				'Horas Trabajadas Op',
				'Horas Trabajadas',
			]),
			integerHeaders: new Set(['Operacion','Semana','Codigo Subservicio','Total Trabajadores','Total Alimentacion','DNI Trabajador','DNITrabajador','Codigo Nomina']),
			preferredWidths: { Subservicio: 42, Observaciones: 42, Supervisores: 30, 'Nombre Trabajador': 28, Buque: 22 },
		});
	}
   
	 //GRUPO DE TRABAjadores SEGUN ID_GROUP, para luego calcular cantidades y horas trabajadas por grupo/subservicio
	private groupWorkersByIdGroup(workers: any[]) {
		const map = new Map<string, any[]>();
		workers.forEach((w) => {
			const key = String(w.id_group || '');
			const list = map.get(key) || [];
			list.push(w);
			map.set(key, list);
		});

		return Array.from(map.entries()).map(([groupId, ws]) => ({
			groupId,
			workers: ws,
			firstWorker: ws[0],
			subserviceCode: ws[0]?.SubTask?.code,
			subserviceName: ws[0]?.SubTask?.name,
			unitMeasure: ws[0]?.tariff?.unitOfMeasure?.name,
		}));
	}

	  //cantidad total del grupo segun unidad de medida (horas/jornal/monto)
	private groupQuantity(groupBills: any[], workersCount: number, unitMeasure?: string) {
		const unit = (unitMeasure || '').toUpperCase();

		if (unit.includes('HORA')) {  //para horas se multiplica por numero de trabajadores
			return groupBills.reduce(
				(acc: number, b: any) => acc + Number(b.number_of_hours || 0) * workersCount,
				0,
			);
		}

		if (unit.includes('JORNAL')) { //para jornal se suman los pay_unit
			return groupBills.reduce(
				(acc: number, b: any) =>
					acc +
					(b.billDetails || []).reduce(
						(detailAcc: number, d: any) => detailAcc + Number(d.pay_unit || 0),
						0,
					),
				0,
			);
		}

		return groupBills.reduce((acc: number, b: any) => acc + Number(b.amount || 0), 0);// para monto se suman los amount
	}

	// Concatenar observaciones de las bills relacionadas, eliminando vacios y separando por " | "
	private joinObservations(bills: any[]) {
		return bills
			.map((b) => String(b.observation || '').trim())
			.filter((v) => !!v)
			.join(' | ');
	}

	// Formatear supervisores a una cadena legible, mostrando nombre o username, o ID si no hay info disponible
	private formatSupervisors(inChargeOperation: any[]) {
		if (!inChargeOperation?.length) return 'Sin supervisor';
		return inChargeOperation
			.map((s) => s.user?.name || s.user?.username || String(s.id_user))
			.join(', ');
	}


   // Etiquetar estados a un formato mas legible para el reporte
   //actualmente solo se manejan en la decarga estado/ COMPLETED (finalizado)
	private statusLabel(status: string) {
		switch (status) {
			case 'PENDING':
				return 'Pendiente';
			case 'INPROGRESS':
				return 'En Curso';
			case 'COMPLETED':
				return 'Finalizado';
			case 'CANCELED':
				return 'Cancelado';
			default:
				return status || 'Desconocido';
		}

	}


	// Funciones para convertir fechas de string a objetos Date en UTC
	private parseDateOnly(value: string): { year: number; month: number; day: number } {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
		if (!match) {
			throw new UnprocessableEntityException(
				`Fecha invalida: ${value}. Formato esperado YYYY-MM-DD`,
			);
		}

		return {
			year: Number(match[1]),
			month: Number(match[2]),
			day: Number(match[3]),
		};
	}


    	private combineDateTimeExcelSerial(
        date?: Date | null,
        time?: string | null,
        ): number | '' {
        if (!date) return '';

      const datePart = this.formatDate(date); // YYYY-MM-DD en UTC
      const [yyyy, month, dd] = datePart.split('-').map((v) => Number(v));
      if (!yyyy || !month || !dd) return '';
      const [hh = '00', mm = '00', ss = '00'] = String(time || '00:00:00')
      .split(':')
      .map((v) => String(v || '00').padStart(2, '0'));

      const h = Number(hh);
      const m = Number(mm);
      const s = Number(ss);

      // Base serial de Excel (sistema 1900)
      const excelEpochMs = Date.UTC(1899, 11, 30, 0, 0, 0, 0);
      const valueMs = Date.UTC(yyyy, month - 1, dd, h, m, s, 0);

      return (valueMs - excelEpochMs) / 86400000;
      }

	// Convertir fecha de inicio al comienzo del día en UTC
	private toUtcStartOfDay(value: string): Date {
		const { year, month, day } = this.parseDateOnly(value);
		return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
	}
  // Convertir fecha de fin al final del día en UTC
	private toUtcEndOfDay(value: string): Date {
		const { year, month, day } = this.parseDateOnly(value);
		return new Date(Date.UTC(year, month - 1, day, 23, 59, 59, 999));
	}
   // Formatear fecha a string YYYY-MM-DD, ajustando a UTC para evitar problemas de zona horaria
	private formatDate(date?: Date | null, _timezone = 'America/Bogota') {
		if (!date) return '';
		const year = date.getUTCFullYear();
		const month = String(date.getUTCMonth() + 1).padStart(2, '0');
		const day = String(date.getUTCDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}
   
	// Calcular número de semana ISO (1-53) para una fecha dada, considerando el lunes como primer día de la semana
	private isoWeek(date?: Date | null) {
		if (!date) return 0;
		const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
		const dayNum = d.getUTCDay() || 7;
		d.setUTCDate(d.getUTCDate() + 4 - dayNum);
		const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
		return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
	}

	// Calcular horas trabajadas entre dos fechas y horas dadas
	private getHoursWorked(
		dateStart?: Date | null,
		timeStart?: string | null,
		dateEnd?: Date | null,
		timeEnd?: string | null,
	) {
		if (!dateStart || !timeStart || !dateEnd || !timeEnd) return '';

		const [sh, sm] = String(timeStart).split(':').map((n) => Number(n || 0));
		const [eh, em] = String(timeEnd).split(':').map((n) => Number(n || 0));

		const start = new Date(dateStart);
		start.setHours(sh, sm, 0, 0);

		const end = new Date(dateEnd);
		end.setHours(eh, em, 0, 0);

		const diff = end.getTime() - start.getTime();
		if (diff < 0) return '0:00';

		return this.hoursToHHMM(diff / 3600000);
	}


    
	private hoursToDecimal(value: string) {
  if (!value) return 0;
  const [h, m] = value.split(':').map(Number);
  return (h || 0) + ((m || 0) / 60);
}

	// Convertir horas decimales a formato HH:MM, manejando casos de NaN y horas negativas
	private hoursToHHMM(decimalHours: number) {
		if (Number.isNaN(decimalHours) || decimalHours < 0) return '0:00';
		const h = Math.floor(decimalHours);
		const m = Math.round((decimalHours - h) * 60);
		if (m === 60) return `${h + 1}:00`;
		return `${h}:${String(m).padStart(2, '0')}`;
	}
     // Redondear nUmeros a 2 decimales, manejando casos de NaN y asegurando precisión
	private round2(n: number) {
		return Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100;
	}


	  // (PROGRAMACION) (HOJA 1)Reporte de programación general, cada fila representa una operación, con campos agregados para tareas, cantidad de trabajadores y turnos
	  private buildProgrammingGeneralRows(operations: any[]) {
		return (operations || []).map((op) => {
			const groups = this.getProgrammingGroups(op);
			const workersCount = groups.reduce((acc: number, g: any) => acc + (g.workers?.length || 0), 0);
			const tasks = Array.from(
				new Set(
					groups
						.map((g: any) => g.subTask?.name)
						.filter((v: string | undefined) => !!v),
				),
			).join(', ');

			return {
				"Operacion": op.id,
				Estado: this.statusLabel(op.status),
				Area: op.jobArea?.name || 'Sin area',
				Cliente: op.client?.name || 'Sin cliente',
				Supervisores: this.formatProgrammingSupervisors(op.inCharge || op.inChargeOperation),
				'Fecha Inicio': this.combineDateTime(op.dateStart, op.timeStrat),
				'Fecha Fin': this.combineDateTime(op.dateEnd, op.timeEnd),
				'Horas Trabajadas': this.hoursToDecimal(this.getHoursWorked(op.dateStart, op.timeStrat, op.dateEnd, op.timeEnd)),
				Buque: op.motorShip || '',
				Tarea: tasks || 'Sin tarea',
				'Total Trabajadores': workersCount,
				Turnos: groups.length,
			};
		});
	}
     
	//  (PROGRAMACION) (HOJA 2) Reporte detallado de programación, cada fila representa un trabajador específico dentro de una operación
	private buildProgrammingDetailRows(operations: any[]) {
		const rows: any[] = [];

		for (const op of operations || []) {
			const groups = this.getProgrammingGroups(op);
			if (!groups.length) {
				rows.push({
					"Operacion": op.id,
					Estado: this.statusLabel(op.status),
					Area: op.jobArea?.name || 'Sin area',
					Cliente: op.client?.name || 'Sin cliente',
					Supervisores: this.formatProgrammingSupervisors(op.inCharge || op.inChargeOperation),
					'Fecha Inicio': this.combineDateTime(op.dateStart, op.timeStrat),
					'Fecha Fin': this.combineDateTime(op.dateEnd, op.timeEnd),
					'Horas Trabajadas': this.getHoursWorked(op.dateStart, op.timeStrat, op.dateEnd, op.timeEnd),
					Buque: op.motorShip || '',
					Tarea: 'Sin tarea',
					Turno: '',
					'DNI Trabajador': 0,
					'Nombre Trabajador': 'Sin trabajadores',
				});
				continue;
			}

			for (let i = 0; i < groups.length; i += 1) {
				const group = groups[i];
				const turno = `Turno ${i + 1}`;
				const workers = group.workers || [];

				for (const worker of workers) {
					rows.push({
						"Operacion": op.id,
						Estado: this.statusLabel(op.status),
						Area: op.jobArea?.name || 'Sin area',
						Cliente: op.client?.name || 'Sin cliente',
						Supervisores: this.formatProgrammingSupervisors(op.inCharge || op.inChargeOperation),

						 //horas unificadas 
						'Fecha Inicio': this.combineDateTime(
							group.schedule?.dateStart,
							group.schedule?.timeStart ,
						),
						 // //horas unificadas
						'Fecha Fin': this.combineDateTime(
							group.schedule?.dateEnd,
							group.schedule?.timeEnd,
						),
						'Horas Trabajadas': this.getHoursWorked(
							group.schedule?.dateStart ,
							group.schedule?.timeStart ,
							group.schedule?.dateEnd ,
							group.schedule?.timeEnd ,
						),
						Buque: op.motorShip || '',
						Tarea: group.subTask?.name || 'Sin tarea',
						Turno: turno,
						'DNI Trabajador': Number(worker.dni || 0),
						'Nombre Trabajador': worker.name || '',
					});
				}
			}
		}

		return rows;
	}

	// (PROGRAMACION) agregar una hoja con bloque de titulo, estadisticas y datos
	private addProgrammingSheet(
		workbook: ExcelJS.Workbook,
		sheetName: string,
		title: string,
		rows: any[],
		stats: Array<{ label: string; value: number }>,
	) {
		const sheet = workbook.addWorksheet(sheetName, {
			pageSetup: { fitToPage: true, fitToHeight: 5, fitToWidth: 7 },
		});

		if (!rows.length) {
			sheet.addRow(['No hay datos para exportar']);
			return;
		}
      
		// Bloque de título fusionado
		const headers = Object.keys(rows[0]); // Obtener encabezados de las claves de la primera fila de datos
		sheet.mergeCells(1, 1, 1, headers.length);// fusionar primera fila para el título
		const titleCell = sheet.getCell(1, 1);// Celda del título
		titleCell.value = title;
		titleCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: '2F5C8F' } };
		titleCell.font = { bold: true, color: { argb: 'FFFFFF' }, size: 13 };
		titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
		sheet.getRow(1).height = 26;

		sheet.getCell(3, 1).value = `Fecha de ${this.formatNowDMYHM()}`;
		sheet.getCell(4, 1).value = 'Periodo: Calendario'; 

		sheet.getCell(6, 1).value = 'ESTADISTICAS'; 
		sheet.getCell(6, 1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'D9D9D9' } }; 
		sheet.getCell(6, 1).font = { bold: true };

		let rowIndex = 7;
		for (const stat of stats) {
			sheet.getCell(rowIndex, 1).value = stat.label; // Etiqueta de la estadística
			sheet.getCell(rowIndex, 2).value = stat.value; // Valor de la estadística
			sheet.getCell(rowIndex, 2).numFmt = '0';  // Formato numérico sin decimales
			rowIndex += 1; // Incrementar el índice de fila para la siguiente estadística
		}

		const headerRowNumber = rowIndex + 1;
		const headerRow = sheet.getRow(headerRowNumber);
		headerRow.values = headers;

		sheet.views = [{ state: 'frozen', ySplit: headerRowNumber }];

		this.applyHeaderStyle(headerRow, '2F5C8F', 11);
		this.applyBodyRows(sheet, rows, headers, headerRowNumber + 1);
		this.applyColumnFormats(sheet, headers, {
			dateTimeHeaders: new Set(['Fecha Inicio', 'Fecha Fin']),
			decimalHeaders: new Set(['Horas Trabajadas']),
			integerHeaders: new Set(['Operacion', 'Total Trabajadores', 'Turnos', 'DNI Trabajador']),
			skipRowsBefore: headerRowNumber,
			maxWidth: 40,
		});
	}


	// Formatear fecha a string DD/MM/YYYY, manejando casos de fechas inválidas o nulas
	private formatDateDMY(value?: Date | string | null): string {
		if (!value) return '';
		const date = value instanceof Date ? value : new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		const dd = String(date.getDate()).padStart(2, '0');
		const mm = String(date.getMonth() + 1).padStart(2, '0');
		const yyyy = String(date.getFullYear());
		return `${dd}/${mm}/${yyyy}`;
	}
   
	 // Formatear fecha y hora actual a string DD/MM/YYYY HH:MM, manejando casos de fechas inválidas o nulas
	private formatNowDMYHM(date = new Date()): string {
		const dd = String(date.getDate()).padStart(2, '0');
		const mm = String(date.getMonth() + 1).padStart(2, '0');
		const yyyy = String(date.getFullYear());
		const hh = String(date.getHours()).padStart(2, '0');
		const min = String(date.getMinutes()).padStart(2, '0');
		return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
	}

	// Formatear datos de supervisores a una cadena legible, mostrando nombre o username, o indicando "Sin supervisor" si no hay datos disponibles
	private formatProgrammingSupervisors(inChargeData: any[]): string {
		if (!inChargeData?.length) return 'Sin supervisor';
		return inChargeData
			.map((item: any) => item?.name || item?.user?.name || item?.username || item?.user?.username)
			.filter((v: string | undefined) => !!v)
			.join(', ') || 'Sin supervisor';
	}

	//(ahora colores por nombre /No por posición) Aplicar estilos al header (color, fuente, bordes) — compartido por RTD y Programacion
	private applyHeaderStyle(
		headerRow: ExcelJS.Row,
		color: string,
		fontSize = 11,
		normalBlueHeader = true,
		greenHeaders: Set<string> = new Set<string>(),
	) {
		headerRow.height = 28;
		headerRow.eachCell((cell, colNumber) => {
			const headerName = String(headerRow.getCell(colNumber).value ?? '').trim();
			const isGreenHeader = !normalBlueHeader && greenHeaders.has(headerName);
			const bg = isGreenHeader ? '70AD47' : color;
			cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: bg } };
			cell.font = { bold: true, color: { argb: 'FFFFFF' }, size: fontSize };
			cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
			cell.border = {
				top: { style: 'thin' }, left: { style: 'thin' },
				bottom: { style: 'thin' }, right: { style: 'thin' },
			};
		});
	}

	// Escribir filas de datos con bordes y color alterno — compartido por RTD y Programacion
	private applyBodyRows(
		sheet: ExcelJS.Worksheet,
		rows: any[],
		headers: string[],
		startRow: number,
		leftHeaders = new Set<string>(),
		centerHeaders = new Set<string>(),
	) {
		for (let i = 0; i < rows.length; i++) {
			const row = sheet.getRow(startRow + i);
			row.values = headers.map((h) => rows[i][h]);
			row.eachCell((cell) => {
				const header = headers[Number(cell.col) - 1];
				let horizontal: 'left' | 'center' | 'right' = 'right';
				if (leftHeaders.has(header)) horizontal = 'left';
				if (centerHeaders.has(header)) horizontal = 'center';
				if (i % 2 === 0) {
					cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F2F7FF' } };
				}
				cell.font = { size: 11, color: { argb: '1F2937' } };
				cell.alignment = { vertical: 'middle', horizontal, wrapText: true };
				cell.border = {
					top: { style: 'thin', color: { argb: 'E0E0E0' } },
					left: { style: 'thin', color: { argb: 'E0E0E0' } },
					bottom: { style: 'thin', color: { argb: 'E0E0E0' } },
					right: { style: 'thin', color: { argb: 'E0E0E0' } },
				};
			});
		}
	}

	// Aplicar formatos numéricos y ancho de columnas — compartido por RTD y Programacion
	private applyColumnFormats(
		sheet: ExcelJS.Worksheet,
		headers: string[],
		opts: {
			dateTimeHeaders?: Set<string>;
			decimalHeaders?: Set<string>;
			integerHeaders?: Set<string>;
			preferredWidths?: Record<string, number>;
			skipRowsBefore?: number;
			maxWidth?: number;
		} = {},
	) {
		const {
			dateTimeHeaders = new Set<string>(),
			decimalHeaders = new Set<string>(),
			integerHeaders = new Set<string>(),
			preferredWidths = {},
			skipRowsBefore = 0,
			maxWidth = 50,
		} = opts;

		headers.forEach((header, idx) => {
			const col = sheet.getColumn(idx + 1);
			if (dateTimeHeaders.has(header)) { col.numFmt = '[$-es-ES,1]dd/mm/yyyy h:mm:ss'; }//retunr;
			if (decimalHeaders.has(header))  { col.numFmt = '#,##0.00';} //retunr;
			if (integerHeaders.has(header))  { col.numFmt = '0'; }

			let max = 12;
			col.eachCell?.({ includeEmpty: true }, (cell) => {
				if (Number(cell.row) <= skipRowsBefore) return;
				const len = String(cell.value ?? '').length;
				if (len > max) max = len;
			});
			col.width = Math.min(Math.max(max + 3, preferredWidths[header] || 0), maxWidth);
		});
	}

	private combineDateTime(date: Date | string | null, time: string | null): number | null {
  if (!date) return null;

  const dateStr =
    typeof date === 'string'
      ? date.split('T')[0]
      : date.toISOString().split('T')[0];

  const [year, month, day] = dateStr.split('-').map(Number);

  if (!year || !month || !day) return null;

  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const targetDate = new Date(Date.UTC(year, month - 1, day));
  const diffTime = targetDate.getTime() - excelEpoch.getTime();
  const excelDate = Math.floor(diffTime / (1000 * 60 * 60 * 24));

  let excelTime = 0;

  if (time) {
    const parts = time.split(':');
    const hours = parseInt(parts[0] || '0', 10);
    const minutes = parseInt(parts[1] || '0', 10);
    const seconds = parseInt(parts[2] || '0', 10);

    excelTime = (hours + minutes / 60 + seconds / 3600) / 24;
  }

  return excelDate + excelTime;
}
	// Agrupar trabajadores de una operación por su id_group, para luego calcular horas trabajadas y cantidades por grupo/subservicio
	private getProgrammingGroups(op: any): any[] {
		if (Array.isArray(op?.workerGroups) && op.workerGroups.length) {
			return op.workerGroups;
		}

		const workers = Array.isArray(op?.workers) ? op.workers : [];
		if (!workers.length) return [];

		const grouped = new Map<string, any[]>();
		for (const w of workers) {
			const key = String(w.id_group || '');
			const list = grouped.get(key) || [];
			list.push(w);
			grouped.set(key, list);
		}

		return Array.from(grouped.values()).map((groupWorkers, idx) => {
			const first = groupWorkers[0] || {};
			return {
				groupId: first.id_group || String(idx + 1),
				schedule: {
					dateStart: first.dateStart || op.dateStart,
					timeStart: first.timeStart || op.timeStrat,
					dateEnd: first.dateEnd || op.dateEnd,
					timeEnd: first.timeEnd || op.timeEnd,
				},
				subTask: first.SubTask
					? { id: first.SubTask.id, name: first.SubTask.name, code: first.SubTask.code }
					: null,
				workers: groupWorkers.map((w: any) => ({
					id: w.id_worker || w.worker?.id,
					name: w.worker?.name || '',
					dni: w.worker?.dni || 0,
				})),
			};
		});
	}
}
