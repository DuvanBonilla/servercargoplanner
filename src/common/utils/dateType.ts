import { format, getDay, getWeek } from 'date-fns';
import { es } from 'date-fns/locale';
import { normalizeColombianDate } from './dateColombia';

const DateHolidays = require('date-holidays');

/**
 * Tipos posibles de día en Colombia
 */
export enum DayType {
  NORMAL = 'NORMAL',
  SUNDAY = 'SUNDAY',
  HOLIDAY = 'HOLIDAY',
}

/**
 * Información detallada sobre una fecha
 */
export interface DateInfo {
  type: DayType;
  isHoliday: boolean;
  isSunday: boolean;
  name?: string;
  date: Date;
  formattedDate: string;
  dayOfWeek: string;
}

// Instancia de Holidays para Colombia
const hd = new DateHolidays('CO');

// Cache para no recalcular los festivos repetidamente
const holidayCache = new Map<number, any[]>();

/**
 * Obtiene festivos colombianos para un año específico
 * @param year El año para el que se requieren los festivos
 * @returns Array con los festivos de Colombia
 */
export function getColombiaDaysOff(year: number): any[] {
  if (!holidayCache.has(year)) {
    const holidays = hd.getHolidays(year);
    holidayCache.set(year, holidays);
  }
  return holidayCache.get(year) || [];
}

/**
 * Obtiene el número de semana del año para una fecha específica
 * @param date Fecha para la cual se quiere obtener el número de semana
 * @returns Número de semana (1-53)
 */


export function getWeekNumber(date: Date | string): number {
  // Normalizar la fecha para evitar problemas de zona horaria
  const normalizedDate = typeof date === 'string' 
    ? toLocalDate(date)
    : toLocalDate(date);
  
  // Utiliza la función getWeek de date-fns con configuración para semanas ISO
  // (semana empieza lunes, primera semana tiene al menos 4 días)
  return getWeek(normalizedDate, { weekStartsOn: 1, firstWeekContainsDate: 4 });
}  // Utiliza la función getWeek de date-fns con configuración para semanas ISO

  // (semana empieza lunes, primera semana tiene al menos 4 días)
  // export function getWeekNumber(date: Date): number {
  // return getWeek(date, { weekStartsOn: 1, firstWeekContainsDate: 4 });
// }

/**
 * Obtiene información básica sobre la semana de una fecha
 * @param date Fecha para la cual se quiere obtener información de semana
 * @returns Objeto con número de semana y año
 */
// export function getWeekInfo(date: Date): { weekNumber: number; year: number } {
//   return {
//     weekNumber: getWeekNumber(date),
//     year: date.getFullYear(),
//   };
// }
export function getWeekInfo(date: Date | string): { weekNumber: number; year: number } {
  const normalizedDate = typeof date === 'string' 
    ? toLocalDate(date)
    : toLocalDate(date);
    
  return {
    weekNumber: getWeekNumber(normalizedDate),
    year: normalizedDate.getFullYear(),
  };
}

/**
 * Determina si una fecha es festivo, domingo o día normal en Colombia
 * @param date Fecha a verificar
 * @returns Objeto con información del tipo de día
 */
export function getDateType(date: Date | string): DateInfo {
  // Normalizar la fecha para evitar problemas con horas
   const normalizedDate = normalizeColombianDate(date);

  // Verificar si es domingo
  const isSunday = getDay(normalizedDate) === 0;

  // Verificar si es festivo usando date-holidays
  const holidayInfo = hd.isHoliday(normalizedDate);
  const isHoliday = !!holidayInfo;
  
  // Obtener nombre del festivo si existe
  let holidayName;
  if (isHoliday && Array.isArray(holidayInfo) && holidayInfo.length > 0) {
    holidayName = holidayInfo[0].name;
  }

  // Determinar tipo de día
  let type = DayType.NORMAL;
  if (isHoliday) {
    type = DayType.HOLIDAY;
  } else if (isSunday) {
    type = DayType.SUNDAY;
  }

  return {
    type,
    isHoliday,
    isSunday,
    name: holidayName,
    date: normalizedDate,
    formattedDate: format(normalizedDate, 'EEEE, d MMMM yyyy', { locale: es }),
    dayOfWeek: format(normalizedDate, 'EEEE', { locale: es }),
  };
}

/**
 * Verifica si una fecha es un día hábil en Colombia (no festivo, no domingo)
 * @param date Fecha a verificar
 * @returns true si es día hábil, false si no
 */
export function isBusinessDay(date: Date): boolean {
  const dateInfo = getDateType(date);
  return dateInfo.type === DayType.NORMAL;
}

/**
 * Verifica si una fecha es festivo en Colombia
 * @param date Fecha a verificar
 * @returns true si es festivo, false si no
 */
export function isHoliday(date: Date): boolean {
  const dateInfo = getDateType(date);
  return dateInfo.isHoliday;
}

/**
 * Verifica si una fecha es domingo
 * @param date Fecha a verificar
 * @returns true si es domingo, false si no
 */
export function isSunday(date: Date): boolean {
  const dateInfo = getDateType(date);
  return dateInfo.isSunday;
}

/**
 * Obtiene el próximo día hábil a partir de una fecha
 * @param date Fecha de referencia
 * @returns La siguiente fecha que es día hábil
 */
export function getNextBusinessDay(date: Date): Date {
  const nextDay = new Date(date);
  nextDay.setDate(nextDay.getDate() + 1);

  while (!isBusinessDay(nextDay)) {
    nextDay.setDate(nextDay.getDate() + 1);
  }

  return nextDay;
}

/**
 * Obtiene todos los días hábiles en un rango de fechas
 * @param startDate Fecha de inicio
 * @param endDate Fecha final
 * @returns Array con todas las fechas que son días hábiles en el rango
 */
export function getBusinessDaysInRange(startDate: Date, endDate: Date): Date[] {
  const businessDays: Date[] = [];
  const currentDate = new Date(startDate);

  while (currentDate <= endDate) {
    if (isBusinessDay(currentDate)) {
      businessDays.push(new Date(currentDate));
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return businessDays;
}

/**
 * Obtiene el nombre del día de la semana en español
 * @param date Fecha
 * @returns Nombre del día en español
 */
export function getDayName(date: Date): string {
  return format(date, 'EEEE', { locale: es });
}

/**
 * Devuelve un array con los nombres de los días de la semana en español para un rango de fechas
 */
export function getDayNamesInRange(startDate: Date | string, endDate: Date | string): string[] {
  const days: string[] = [];

  // Siempre crear fechas locales (sin zona horaria)
  const toLocalDate = (d: Date | string) =>
    typeof d === 'string'
      ? new Date(
          Number(d.slice(0, 4)),
          Number(d.slice(5, 7)) - 1,
          Number(d.slice(8, 10))
        )
      : new Date(d.getFullYear(), d.getMonth(), d.getDate());

  const currentDate = toLocalDate(startDate);
  const endDateCopy = toLocalDate(endDate);

  while (currentDate <= endDateCopy) {
    days.push(getDayName(currentDate));
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return days;
}

export function toLocalDate(date: Date | string): Date {
  if (typeof date === 'string') {
    // Si es tipo 'YYYY-MM-DD'
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [y, m, d2] = date.split('-').map(Number);
      return new Date(y, m - 1, d2);
    }
    // ✅ SOLUCIÓN: Para fechas ISO con zona horaria, extraer solo año, mes, día
    // y crear fecha local sin considerar la zona horaria UTC
    const y = Number(date.slice(0, 4));
    const m = Number(date.slice(5, 7)) - 1;
    const d2 = Number(date.slice(8, 10));
    

    
    return new Date(y, m, d2);
  }
  
  // FIX: Si es objeto Date de Prisma, obtener la fecha UTC correcta
  // sin aplicar conversión de zona horaria
  if (date instanceof Date) {
    // Usar fechas UTC para evitar problemas de zona horaria
    return new Date(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  }
  
  // Fallback: Si no es Date ni string
  return new Date();
}
/**
 * Retorna true si hay al menos un domingo en el rango de fechas
 */
export function hasSundayInRange(startDate: Date | string, endDate: Date | string): boolean {
  // Asegurar que se usen fechas normalizadas
  const localStart = toLocalDate(startDate);
  const localEnd = toLocalDate(endDate);
  const currentDate = new Date(localStart.getFullYear(), localStart.getMonth(), localStart.getDate());
  
  while (currentDate <= localEnd) {
    if (getDay(currentDate) === 0) { // 0 = domingo
      return true;
    }
    currentDate.setDate(currentDate.getDate() + 1);
  }
  
  return false;
}

/**
 * Determina si una operación debe usar límites de horas para domingo
 */
export function shouldUseSundayHours(startDate: Date, endDate: Date): boolean {
  return hasSundayInRange(startDate, endDate);
}
