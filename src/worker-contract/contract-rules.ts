import { ContractType } from '@prisma/client';
import {
  addColombianDays,
  addColombianMonths,
} from 'src/common/utils/dateColombia';

/**
 * Reglas por modalidad de contrato. La duración se expresa en meses o días
 * calendario; el vencimiento estipulado es inicio + duración - 1 día.
 *
 * Si un contrato a término llega a su vencimiento estipulado se renueva
 * automáticamente (temas contables), por eso la fecha de terminación que se
 * guarda es `terminationDaysBefore` días ANTES de ese vencimiento.
 */
interface ContractRule {
  /** Duración por defecto para calcular el vencimiento estipulado */
  default?: { months?: number; days?: number };
  /** Duración mínima al registrar (solo aprendizaje) */
  min?: { months?: number; days?: number };
  /** Duración máxima al registrar */
  max?: { months?: number; days?: number };
  /** Días antes del vencimiento estipulado en que se termina el contrato */
  terminationDaysBefore: number;
}

export const CONTRACT_RULES: Record<ContractType, ContractRule> = {
  // Obra labor: no supera 1 año; el usuario indica el vencimiento de la obra
  OBRA_LABOR: { max: { months: 12 }, terminationDaysBefore: 2 },
  // Definido de 13 semanas
  FIXED_13_WEEKS: { default: { days: 13 * 7 }, max: { days: 13 * 7 }, terminationDaysBefore: 2 },
  // Definido de 3 meses
  FIXED_3_MONTHS: { default: { months: 3 }, max: { months: 3 }, terminationDaysBefore: 1 },
  // Definido de 1 año
  FIXED_1_YEAR: { default: { months: 12 }, max: { months: 12 }, terminationDaysBefore: 2 },
  // Indefinido: solo fecha de inicio; la terminación se registra al cerrarlo
  INDEFINITE: { terminationDaysBefore: 0 },
  // Aprendizaje: 6 meses a 1 año desde el inicio; solo GH puede extenderlo después
  APPRENTICESHIP: { default: { months: 6 }, min: { months: 6 }, max: { months: 12 }, terminationDaysBefore: 0 },
};

/** Último día de un periodo que empieza en `start` y dura `duration` */
export const periodEnd = (start: Date, duration: { months?: number; days?: number }): Date =>
  duration.months !== undefined
    ? addColombianDays(addColombianMonths(start, duration.months), -1)
    : addColombianDays(start, (duration.days ?? 1) - 1);

/** Fecha de terminación a partir del vencimiento estipulado */
export const terminationFrom = (type: ContractType, stipulatedEnd: Date): Date =>
  addColombianDays(stipulatedEnd, -CONTRACT_RULES[type].terminationDaysBefore);

/** Modalidades a término que pueden quedar sin terminación por reubicación del trabajador */
export const RELOCATION_TYPES: ContractType[] = ['OBRA_LABOR', 'FIXED_13_WEEKS', 'FIXED_3_MONTHS', 'FIXED_1_YEAR'];

/** Modalidades en las que el usuario indica el vencimiento estipulado */
export const STIPULATED_END_TYPES: ContractType[] = ['OBRA_LABOR'];

/**
 * Vencimiento estipulado según la modalidad. `months` permite escoger la
 * duración del aprendizaje (6 a 12); en obra labor lo indica el usuario.
 */
export const stipulatedEndDate = (
  type: ContractType,
  start: Date,
  options: { months?: number; stipulatedEnd?: Date } = {},
): Date | null => {
  if (type === 'OBRA_LABOR') return options.stipulatedEnd ?? null;
  if (type === 'APPRENTICESHIP' && options.months !== undefined) return periodEnd(start, { months: options.months });
  const rule = CONTRACT_RULES[type];
  return rule.default ? periodEnd(start, rule.default) : null;
};

/** Fecha de terminación calculada (null = sin cálculo: indefinido u obra labor sin vencimiento) */
export const calculateEndDate = (
  type: ContractType,
  start: Date,
  options: { months?: number; stipulatedEnd?: Date } = {},
): Date | null => {
  const stipulated = stipulatedEndDate(type, start, options);
  return stipulated ? terminationFrom(type, stipulated) : null;
};

/** Fecha de terminación máxima permitida al registrar */
export const maxEndDate = (type: ContractType, start: Date): Date | null => {
  const rule = CONTRACT_RULES[type];
  return rule.max ? terminationFrom(type, periodEnd(start, rule.max)) : null;
};

export const minEndDate = (type: ContractType, start: Date): Date | null => {
  const rule = CONTRACT_RULES[type];
  return rule.min ? terminationFrom(type, periodEnd(start, rule.min)) : null;
};
