import {
  PipeTransform,
  Injectable,
  ArgumentMetadata,
  BadRequestException,
} from '@nestjs/common';

@Injectable()
export class DateTransformPipe implements PipeTransform {
  transform(value: any, metadata: ArgumentMetadata) {
    // Ignorar parámetros de decoradores personalizados (e.g. @CurrentUser)
    if (metadata.type === 'custom') {
      return value;
    }

    // Si no hay valor, retornar sin cambios
    if (value === undefined || value === null) {
      return value;
    }

    try {
      // Caso 1: Valor es un string (como parámetro de ruta)
      if (typeof value === 'string') {
        return this.transformDateString(value, metadata.data || 'date');
      }

      // Caso 2: Valor es un objeto (body o query)
      if (typeof value === 'object') {
        return this.transformDateObject(value);
      }

      // Para cualquier otro tipo, retornar sin cambios
      return value;
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        `Error transformando fechas: ${(error as Error).message}`,
      );
    }
  }

  // Transformar un string de fecha
  private transformDateString(dateStr: string, fieldName: string): Date {
    if (!this.isValidDateFormat(dateStr)) {
      throw new BadRequestException(
        `${fieldName} debe tener formato YYYY-MM-DD: ${dateStr}`,
      );
    }
    
    // Convertir a objeto Date
    const date = new Date(dateStr);
    
    return date;
  }

  // Transformar un objeto con campos de fecha
  private transformDateObject(obj: any): any {
    // Crear una copia del objeto para no modificar el original
    const result = { ...obj };

    // Lista de campos de fecha que podrían necesitar transformación
    const dateFields = [
      'dateStart',
      'dateEnd',
      'dateDisableStart',
      'dateDisableEnd',
      'dateRetierment',
    ];

    // Procesar todos los campos de fecha
    for (const field of dateFields) {
      // Verificar si el campo existe y no está vacío
      if (
        result[field] !== undefined &&
        result[field] !== null && 
        result[field] !== ''
      ) {
        if (typeof result[field] === 'string') {
          if (!this.isValidDateFormat(result[field])) {
            throw new BadRequestException(
              `${field} debe tener formato YYYY-MM-DD,,,,,: ${result[field]}`,
            );
          }
          // Convertir a objeto Date
          result[field] = new Date(result[field]);
        
        }
      } else if (result[field] === '') {
        // Si es una cadena vacía, asignar null para campos opcionales
        result[field] = null;
      }
    }

    // Lista de campos de fecha y hora que necesitan transformación
    const dateTimeFields = ['dateFeeding'];

    // Procesar campos de fecha y hora
    for (const field of dateTimeFields) {
      if (
        result[field] !== undefined &&
        result[field] !== null && 
        result[field] !== ''
      ) {
        if (typeof result[field] === 'string') {
          if (!this.isValidDateTimeFormat(result[field])) {
            throw new BadRequestException(
              `${field} debe tener formato YYYY-MM-DD HH:MM o YYYY-MM-DDTHH:MM:SS: ${result[field]}`,
            );
          }
          if (result[field].includes(' ')) {
            result[field] = result[field].replace(' ', 'T') + ':00.000Z';
          }
        }
      } else if (result[field] === '') {
        // Si es una cadena vacía, asignar null para campos opcionales
        result[field] = null;
      }
    }

    // Lista de campos de hora que podrían necesitar validación
    const timeFields = ['timeStrat', 'timeEnd', 'timeStart'];

    // Procesar todos los campos de hora
    for (const field of timeFields) {
      // Verificar si el campo existe y no está vacío
      if (
        result[field] !== undefined && 
        result[field] !== null && 
        result[field] !== ''
      ) {
        if (typeof result[field] === 'string') {
          if (!this.isValidTimeFormat(result[field])) {
            throw new BadRequestException(
              `${field} debe tener formato HH:MM: ${result[field]}`,
            );
          }
        }
      } else if (result[field] === '') {
        // Si es una cadena vacía, asignar null para campos opcionales
        result[field] = null;
      }
    }

    return result;
  }

  // Validar formato YYYY-MM-DD
  private isValidDateFormat(dateStr: string): boolean {
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateStr)) {
      return false;
    }

    // Verificar que sea una fecha válida
    const date = new Date(dateStr);
    return date instanceof Date && !isNaN(date.getTime());
  }

  // Validar formato de fecha y hora (YYYY-MM-DD HH:MM o ISO)
  private isValidDateTimeFormat(dateTimeStr: string): boolean {
    // Dos formatos posibles:
    // 1. ISO format: YYYY-MM-DDTHH:MM:SS.sssZ
    // 2. Formato simple: YYYY-MM-DD HH:MM
    
    // Verificar formato ISO
    const isoRegex = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/;
    
    // Verificar formato simple YYYY-MM-DD HH:MM
    const simpleRegex = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;
    
    if (!isoRegex.test(dateTimeStr) && !simpleRegex.test(dateTimeStr)) {
      return false;
    }

    // Verificar que sea una fecha y hora válida
    const date = new Date(dateTimeStr);
    return date instanceof Date && !isNaN(date.getTime());
  }

  // Validar formato HH:MM
  private isValidTimeFormat(timeStr: string): boolean {
    const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
    return timeRegex.test(timeStr);
  }
}