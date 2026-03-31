// import { Injectable } from '@nestjs/common';
// import * as ExcelJS from 'exceljs';
// import { Response } from 'express';

// @Injectable()
// export class ExcelExportService {
//   /**
//    * Exporta datos a un archivo Excel
//    * @param res - Objeto Response de Express
//    * @param data - Datos a exportar
//    * @param fileName - Nombre del archivo
//    * @param sheetName - Nombre de la hoja
//    */
//   async exportToExcel(
//     res: Response | null,
//     data: any[],
//     fileName: string = 'export',
//     sheetName: string = 'DatosQQ',
//     format: 'binary' | 'base64' = 'binary'
//   ): Promise<void | { base64: string, fileName: string }> {
//     // Crear un nuevo libro de trabajo
//     const workbook = new ExcelJS.Workbook();
//     const worksheet = workbook.addWorksheet(sheetName);

//     // Si no hay datos, crear una hoja vacía con un mensaje
//     if (!data || data.length === 0) {
//       worksheet.addRow(['No hay datos para exportar']);
//     } else {
//       // Extraer nombres de columnas del primer objeto
//       const firstItem = data[0];
//       const columns = Object.keys(this.flattenObject(firstItem));
      
//       // Columnas con formato mejorado
//       const excelColumns = columns.map(key => ({
//         header: this.formatColumnHeader(key),
//         key,
//         width: 20
//       }));
      
//       worksheet.columns = excelColumns;

//       // Agregar estilos al encabezado
//       worksheet.getRow(1).font = { bold: true, size: 12 };
//       worksheet.getRow(1).fill = {
//         type: 'pattern',
//         pattern: 'solid',
//         fgColor: { argb: 'FF4F81BD' }
//       };
//       worksheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };

//       // Agregar los datos como filas
//       const flattenedData = data.map(item => this.flattenObject(item));
//       worksheet.addRows(flattenedData);

//       // Aplicar formato a todas las celdas
//       worksheet.eachRow((row, rowNumber) => {
//         row.eachCell((cell) => {
//           cell.border = {
//             top: { style: 'thin' },
//             left: { style: 'thin' },
//             bottom: { style: 'thin' },
//             right: { style: 'thin' }
//           };
          
//           // Alternar colores de fondo en las filas
//           if (rowNumber > 1) {
//             if (rowNumber % 2 === 0) {
//               cell.fill = {
//                 type: 'pattern',
//                 pattern: 'solid',
//                 fgColor: { argb: 'FFF2F2F2' }
//               };
//             }
//           }
          
//           // Formato para fechas
//           if (cell.value instanceof Date) {
//             cell.numFmt = 'dd/mm/yyyy';
//           }
//         });
//       });
//     }

//     // Obtener el buffer del Excel
//     const buffer = await workbook.xlsx.writeBuffer();
    
//     // Si se solicita formato base64, convertir el buffer y devolverlo
//     if (format === 'base64') {
//       const base64 = Buffer.from(buffer).toString('base64');
//       return {
//         base64,
//         fileName: `${fileName}.xlsx`
//       };
//     }
    
//     // Si hay objeto response, enviar como descarga de archivo
//     if (res) {
//       res.setHeader(
//         'Content-Type',
//         'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
//       );
//       res.setHeader('Content-Disposition', `attachment; filename=${fileName}.xlsx`);
//       res.send(buffer);
//     } else {
//       throw new Error('Se requiere un objeto Response para formato binario');
//     }
//   }

//   /**
//    * Aplana objetos anidados para la exportación a Excel
//    * @param obj - Objeto a aplanar
//    * @param prefix - Prefijo para nombres de propiedad anidados
//    * @returns Objeto aplanado
//    */
//   private flattenObject(obj: any, prefix: string = ''): any {
//     const result: any = {};
    
//     for (const key in obj) {
//       if (obj.hasOwnProperty(key)) {
//         const propName = prefix ? `${prefix}.${key}` : key;
        
//         // Si es null o undefined, mantener como vacío
//         if (obj[key] === null || obj[key] === undefined) {
//           result[propName] = '';
//         }
//         // Si es un objeto anidado (pero no una fecha)
//         else if (typeof obj[key] === 'object' && !(obj[key] instanceof Date) && !Array.isArray(obj[key])) {
//           // Recursivamente aplanar el objeto anidado
//           const flattened = this.flattenObject(obj[key], propName);
//           Object.assign(result, flattened);
//         }
//         // Si es un array
//         else if (Array.isArray(obj[key])) {
//           result[propName] = obj[key].join(', ');
//         }
//         // Otros tipos de datos
//         else {
//           result[propName] = obj[key];
//         }
//       }
//     }
    
//     return result;
//   }

//   /**
//    * Formatea nombres de encabezado para hacerlos más legibles
//    * @param columnName - Nombre de la columna original
//    * @returns Nombre de columna formateado
//    */
//   private formatColumnHeader(columnName: string): string {
//     // Reemplazar puntos con espacios (para propiedades anidadas)
//     let formatted = columnName.replace(/\./g, ' - ');
    
//     // Reemplazar guiones bajos con espacios
//     formatted = formatted.replace(/_/g, ' ');
    
//     // Capitalizar primera letra de cada palabra
//     formatted = formatted.replace(/\b\w/g, char => char.toUpperCase());
    
//     // Manejar "ID" específicamente
//     formatted = formatted.replace(/\bId\b/g, 'ID');
   
//     formatted = formatted.replace(/\bDateDisableEnd\b/g, 'Fecha Final');
//     formatted = formatted.replace(/\bDateDisableStart\b/g, 'Fecha Inicio');
//     formatted = formatted.replace(/\bType\b/g, 'Tipo');
//     formatted = formatted.replace(/\bCause\b/g, 'Causa');
//     formatted = formatted.replace(/\bID Worker\b/g, 'ID Trabajador');
//     formatted = formatted.replace(/\bWorker - Name\b/g, 'Nombre de Trabajador');
//     formatted = formatted.replace(/\bWorker - Dni\b/g, 'CC Trabajador');
    
//     return formatted;
//   }
// }