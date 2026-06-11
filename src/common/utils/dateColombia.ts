/** Colombia es siempre UTC-5, sin horario de verano (DST). */
// const COLOMBIA_OFFSET_MS = 5 * 60 * 60 * 1000;

export const getColombianDateTime = (): Date => { 
  // Aritmética UTC pura: evita el anti-patrón new Date(toLocaleString(...))
  // que en algunas configuraciones aplica el offset histórico LMT de Bogotá
  // (-4:56:16 en lugar de -5:00:00), causando un desfase de ~4 minutos.
  return new Date(Date.now());
};

// Función para obtener solo la hora en formato HH:MM
export const getColombianTimeString = () => {
  const now = new Date();
  return now.toLocaleTimeString('en-US', {
    timeZone: 'America/Bogota',
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Crea el inicio del día en zona horaria de Colombia.
 * Recibe un Date cuyo valor UTC ya representa la hora colombiana
 * (producido por getColombianDateTime) y extrae la fecha con getUTC*.
 */
export const getColombianStartOfDay = (date: Date): Date => {
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, 0, 0, 0),
  );
};

/**
 * Crea el fin del día en zona horaria de Colombia.
 */
export const getColombianEndOfDay = (date: Date): Date => {
  const startOfDay = getColombianStartOfDay(date);
  return new Date(startOfDay.getTime() + 24 * 60 * 60 * 1000);
};

/**
 * Normaliza una fecha a la zona horaria colombiana independientemente del formato de entrada
 * @param date Fecha en cualquier formato (string, Date, timestamp)
 * @returns Fecha normalizada en zona horaria colombiana
 */
export const normalizeColombianDate = (date: Date | string | number): Date => {
  let tempDate: Date;

  // Convertir el input a objeto Date según su tipo
  if (typeof date === 'string') {
    // Si es un string ISO (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const [year, month, day] = date.split('-').map(Number);
      // Meses en JavaScript son 0-indexados (enero = 0)
      tempDate = new Date(year, month - 1, day, 12, 0, 0);
    } else {
      // Para otros formatos de string
      tempDate = new Date(date);
    }
  } else if (typeof date === 'number') {
    // Si es timestamp
    tempDate = new Date(date);
  } else {
    // Si ya es un objeto Date
    tempDate = new Date(date);
  }

  // Normalizar a zona horaria colombiana y asegurar que sea el día correcto
  const colombianDate = new Date(
    tempDate.toLocaleString('en-US', { timeZone: 'America/Bogota' }),
  );

  // Retornar fecha al mediodía para evitar problemas con cambios de horario
  return new Date(
    colombianDate.getFullYear(),
    colombianDate.getMonth(),
    colombianDate.getDate(),
    12,
    0,
    0,
  );
};

/**
 * Formatea una fecha en formato colombiano (DD/MM/YYYY)
 * @param date Fecha a formatear
 * @returns String en formato DD/MM/YYYY
 */
export const formatColombianDate = (date: Date | string | number): string => {
  const normalizedDate = normalizeColombianDate(date);
  const day = String(normalizedDate.getDate()).padStart(2, '0');
  const month = String(normalizedDate.getMonth() + 1).padStart(2, '0');
  const year = normalizedDate.getFullYear();

  return `${day}/${month}/${year}`;
};

/**
 * Formatea una fecha en formato ISO (YYYY-MM-DD)
 * @param date Fecha a formatear
 * @returns String en formato YYYY-MM-DD
 */
export const formatColombianISODate = (
  date: Date | string | number,
): string => {
  const normalizedDate = normalizeColombianDate(date);
  const day = String(normalizedDate.getDate()).padStart(2, '0');
  const month = String(normalizedDate.getMonth() + 1).padStart(2, '0');
  const year = normalizedDate.getFullYear();

  return `${year}-${month}-${day}`;
};
