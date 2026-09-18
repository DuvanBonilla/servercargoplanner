import { FeedingStatus } from '@prisma/client';

/**
 * Franja horaria "típica" de cada tipo de comida, en minutos desde
 * medianoche. Ya no se usa para bloquear el registro de una alimentación
 * (se puede registrar cualquier tipo en cualquier fecha dentro del rango del
 * grupo) — solo para sugerir/filtrar por defecto qué tipos tiene sentido
 * ofrecer en una fecha dada, en base a las horas en que el grupo estuvo
 * activo ese día (ver FeedingService.getGroupFeedingRoster).
 */
export const MEAL_SCHEDULE: Record<FeedingStatus, { start: number; end: number }> = {
  BREAKFAST: { start: 6 * 60, end: 7 * 60 }, // 6:00 - 7:00
  LUNCH: { start: 12 * 60, end: 13 * 60 }, // 12:00 - 13:00
  DINNER: { start: 18 * 60, end: 19 * 60 }, // 18:00 - 19:00
  SNACK: { start: 23 * 60, end: 24 * 60 }, // 23:00 - 24:00
};

export const FEEDING_TYPE_NAMES: Record<FeedingStatus, string> = {
  BREAKFAST: 'desayuno',
  LUNCH: 'almuerzo',
  DINNER: 'cena',
  SNACK: 'refrigerio',
};
