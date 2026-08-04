import { getColombianDateTime } from './dateColombia';

/**
 * dateDisableStart/dateDisableEnd de Inability son @db.Date (fecha calendario
 * pura, sin hora), guardadas como medianoche UTC. Su fecha real está en los
 * componentes UTC del Date; convertir a otra zona (ej. América/Bogotá) la
 * desplaza un día hacia atrás (2026-08-04T00:00:00Z se vería como
 * 2026-08-03 en Bogotá).
 */
function dateOnlyToString(date: Date | string): string {
  if (typeof date === 'string') {
    return date.slice(0, 10);
  }
  return date.toISOString().split('T')[0];
}

function getTodayColombia(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'America/Bogota',
  }).format(getColombianDateTime());
}

/**
 * Verifica si una incapacidad es vigente AHORA (la fecha actual, en Colombia,
 * está dentro del rango dateDisableStart..dateDisableEnd, inclusive).
 */
export function isInabilityActive(inability: any): boolean {
  const today = getTodayColombia();
  const startDate = dateOnlyToString(inability.dateDisableStart);
  const endDate = dateOnlyToString(inability.dateDisableEnd);

  return today >= startDate && today <= endDate;
}
