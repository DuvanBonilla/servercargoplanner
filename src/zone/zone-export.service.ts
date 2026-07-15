import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import { PassThrough } from 'stream';
import { PrismaService } from 'src/prisma/prisma.service';

const BATCH = 500; // cantidad de registros que se leen de la DB por lote (paginación por cursor)

// Columnas fijas del Excel de zonas
const COLUMNS = [
  { header: 'ID', key: 'id', width: 10 },
  { header: 'Zona', key: 'name', width: 32 },
  { header: 'Sede', key: 'site', width: 24 },
  { header: 'Estado', key: 'status', width: 16 },
];

/**
 * Servicio para exportar zonas a Excel usando streaming con paginación por cursor
 * (no carga todos los registros en memoria de una vez). Sin límite de exportaciones
 * concurrentes ni tiempo máximo, a diferencia de Bill/Operation.
 * @class ZoneExportService
 */
@Injectable()
export class ZoneExportService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Arma el filtro (where) de Prisma para la consulta de exportación
   * @param search Texto a buscar en el nombre de la zona (opcional)
   * @param id_site Sede a la que restringir la exportación (opcional)
   */
  private buildWhere(search?: string, id_site?: number): any {
    return {
      ...(typeof id_site === 'number' && !Number.isNaN(id_site) ? { id_site } : {}),
      ...(search?.trim() ? { name: { contains: search.trim(), mode: 'insensitive' } } : {}),
    };
  }

  /**
   * Genera el archivo Excel de zonas en streaming, leyendo la DB por lotes (BATCH)
   * para no cargar todos los registros en memoria de una vez.
   * @param search Texto opcional para filtrar por nombre
   * @param id_site Sede opcional para restringir la exportación
   * @returns Un stream con el archivo y el nombre sugerido para descargarlo
   */
  async exportToExcel(search?: string, id_site?: number) {
    const where = this.buildWhere(search, id_site);
    const filename = `zonas_${new Date().toISOString().split('T')[0]}.xlsx`;

    const stream = new PassThrough();
    // Se detiene la lectura si el cliente cancela la descarga o el stream falla
    const abort = new AbortController();
    stream.once('close', () => abort.abort());
    stream.once('error', () => abort.abort());

    // WorkbookWriter en modo streaming: escribe filas al stream sin acumular todo el Excel en RAM
    const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream, useStyles: true, useSharedStrings: false });
    const ws = wb.addWorksheet('Zonas', { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = COLUMNS;

    // Estilo del encabezado (fila 1)
    const hdr = ws.getRow(1);
    hdr.height = 24;
    hdr.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF2F64B3' } };
      cell.alignment = { vertical: 'middle', horizontal: 'center' };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD9E2F3' } },
        left: { style: 'thin', color: { argb: 'FFD9E2F3' } },
        bottom: { style: 'thin', color: { argb: 'FFD9E2F3' } },
        right: { style: 'thin', color: { argb: 'FFD9E2F3' } },
      };
    });
    hdr.commit();

    const border: any = {
      top: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      left: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } },
      right: { style: 'thin', color: { argb: 'FFE5E7EB' } },
    };

    // Escritura asíncrona en segundo plano: lee de la DB por lotes y va escribiendo filas al stream
    void (async () => {
      try {
        let cursor: number | undefined;
        let rowNumber = 2;

        while (!abort.signal.aborted) {
          // Paginación por cursor (más eficiente que OFFSET/LIMIT para datasets grandes)
          const batch = await this.prisma.zone.findMany({
            where,
            orderBy: { id: 'asc' },
            take: BATCH,
            select: {
              id: true,
              name: true,
              status: true,
              Site: { select: { name: true } }, // nombre de la sede, para la columna "Sede"
            },
            ...(cursor !== undefined ? { cursor: { id: cursor }, skip: 1 } : {}),
          });
          if (abort.signal.aborted || batch.length === 0) break;
          cursor = batch[batch.length - 1].id;

          for (const zone of batch) {
            if (abort.signal.aborted) break;
            const row = ws.addRow({
              id: zone.id,
              name: zone.name,
              site: zone.Site?.name || 'N/A',
              status: zone.status === 'ACTIVE' ? 'Activo' : 'Inactivo',
            });
            row.height = 22;
            // Filas alternadas (zebra striping) para facilitar la lectura
            row.eachCell({ includeEmpty: true }, (cell, col) => {
              cell.font = { size: 10, name: 'Arial' };
              cell.alignment = { vertical: 'middle', horizontal: col === 2 || col === 3 ? 'left' : 'center', wrapText: false };
              cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: rowNumber % 2 === 0 ? 'FFF7F9FC' : 'FFFFFFFF' } };
              cell.border = border;
            });
            row.commit();
            rowNumber++;
          }
          // Si el lote vino incompleto, ya no hay más registros que leer
          if (batch.length < BATCH) break;
        }

        if (!abort.signal.aborted) await wb.commit();
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        console.error('[ZoneExport] Error durante escritura:', error.message);
        if (!stream.destroyed) stream.destroy(error);
      }
    })();

    // Devuelve el stream de inmediato; el llenado de filas sigue ocurriendo en segundo plano
    return { stream, fileName: filename };
  }
}
