import { InabilityOrigin, TypeDisability } from '@prisma/client';
import {
  addColombianDays,
  addColombianMonths,
  formatColombianISODate,
  getDaysBetween,
  toColombianDateOnly,
} from 'src/common/utils/dateColombia';

/**
 * Reglas de liquidación de incapacidades confirmadas por Gestión Humana.
 * Funciones puras: no consultan la BD.
 */

/** Días que paga la empresa al inicio (origen general 2, laboral 1; licencias 0) */
export const COMPANY_FIRST_DAYS: Record<InabilityOrigin, number> = {
  GENERAL: 2,
  LABOR: 1,
  MATERNITY: 0,
  PATERNITY: 0,
};
/** Con menos de estos días de contrato al inicio, la empresa paga todos los días */
export const MIN_CONTRACT_DAYS = 28;
/** Máximo de días entre el fin de la anterior y el inicio de la nueva para que sea prórroga */
export const MAX_EXTENSION_GAP_DAYS = 30;
/** Prórroga que inicia dentro de estos días desde el inicio de la INICIAL: la empresa vuelve a pagar los primeros días */
export const EXTENSION_COMPANY_WINDOW_DAYS = 30;
/** Días 181 a 540 de origen común: fondo de pensiones al 50% del IBC */
export const PENSION_FUND_FROM_DAY = 181;
export const PENSION_FUND_TO_DAY = 540;
/** Plazo para radicar contado desde el inicio: IPS adscrita a la red 30 días, no adscrita 15 */
export const FILING_DAYS_IN_NETWORK = 30;
export const FILING_DAYS_OUT_OF_NETWORK = 15;
/** Plazo para recobrar: 3 años */
export const RECOVERY_MONTHS = 36;

export type Payer = 'COMPANY' | 'EPS' | 'ARL' | 'PENSION_FUND';
export type PaymentReason =
  | 'CONTRACT_UNDER_28_DAYS'
  | 'COMPANY_FIRST_DAYS'
  | 'EXTENSION_WITHIN_30_DAYS'
  | 'LICENSE'
  | 'ENTITY'
  | 'PENSION_FUND_181_540'
  | 'OVER_540_DAYS';

export interface PaymentSegment {
  from: string;
  to: string;
  days: number;
  /** Día de la cadena de prórrogas (1 = primer día de la INICIAL) */
  chainDayFrom: number;
  chainDayTo: number;
  payer: Payer;
  reason: PaymentReason;
}

export const entityOf = (origin: InabilityOrigin): Payer => (origin === 'LABOR' ? 'ARL' : 'EPS');

/** Códigos CIE-10 comparables: mayúsculas, sin espacios ni puntos */
export const normalizeDiagnosis = (code?: string | null) =>
  (code ?? '').toUpperCase().replace(/[\s.]/g, '') || null;

export const inclusiveDays = (start: Date, end: Date) => getDaysBetween(start, end) + 1;

export interface ChainInability {
  id: number;
  dateDisableStart: Date;
  dateDisableEnd: Date;
  id_extension_of: number | null;
  id_company: number | null;
  diagnosisPrincipal: string | null;
  diagnosesRelated: string[];
  externalChainStart?: Date | null;
  externalChainDays?: number | null;
}

/**
 * Busca la incapacidad de la que la nueva sería prórroga: mismo código CIE-10
 * exacto (principal o relacionado, en cualquier combinación), que terminó antes
 * del inicio y con no más de 30 días entre su fin y el inicio de la nueva. No
 * cruza empresas: si ambas tienen empresa y es distinta, es una INICIAL.
 * Si hay varias, la que terminó más cerca del inicio.
 */
export function findExtensionCandidate(
  history: ChainInability[],
  startDate: Date,
  diagnoses: (string | null | undefined)[],
  id_company: number | null,
) {
  const codes = new Set(diagnoses.map(normalizeDiagnosis).filter(Boolean));
  if (!codes.size) return null;
  const candidates = history.filter((prev) => {
    const gap = getDaysBetween(prev.dateDisableEnd, startDate);
    if (gap < 1 || gap > MAX_EXTENSION_GAP_DAYS) return false;
    if (id_company && prev.id_company && prev.id_company !== id_company) return false;
    return [prev.diagnosisPrincipal, ...prev.diagnosesRelated].some((c) => {
      const code = normalizeDiagnosis(c);
      return code !== null && codes.has(code);
    });
  });
  candidates.sort((a, b) => b.dateDisableEnd.getTime() - a.dateDisableEnd.getTime());
  return candidates[0] ?? null;
}

/** Cadena de prórrogas desde la INICIAL hasta `last` (incluida), en orden */
export function chainOf(history: ChainInability[], last: ChainInability): ChainInability[] {
  const byId = new Map(history.map((i) => [i.id, i]));
  const chain: ChainInability[] = [];
  const seen = new Set<number>();
  let current: ChainInability | undefined = last;
  while (current && !seen.has(current.id)) {
    chain.unshift(current);
    seen.add(current.id);
    current = current.id_extension_of ? byId.get(current.id_extension_of) : undefined;
  }
  return chain;
}

export interface PaymentInput {
  origin: InabilityOrigin;
  startDate: Date;
  days: number;
  classification: TypeDisability;
  /** Inicio de la INICIAL de la cadena (solo prórroga) */
  chainRootStart: Date | null;
  /** Días acumulados de la cadena antes de esta incapacidad */
  chainDaysBefore: number;
  /** Días de contrato cumplidos al inicio; null si no hay contrato */
  contractDays: number | null;
}

/**
 * Reparte los días de la incapacidad entre empresa, EPS/ARL y fondo de pensiones:
 * - Licencias de maternidad/paternidad: todo la EPS (sin regla de 28 días).
 * - Menos de 28 días de contrato al inicio: la empresa paga todo.
 * - INICIAL: la empresa paga los primeros días (general 2, laboral 1).
 * - PRÓRROGA que inicia dentro de 30 días desde el inicio de la INICIAL: la
 *   empresa vuelve a pagar los primeros días; después la EPS/ARL paga todo.
 * - Origen común, días 181–540 de la cadena: fondo de pensiones.
 */
export function calculatePayment(input: PaymentInput) {
  const entity = entityOf(input.origin);
  const isLicense = input.origin === 'MATERNITY' || input.origin === 'PATERNITY';
  const underMinContract =
    !isLicense && input.contractDays !== null && input.contractDays < MIN_CONTRACT_DAYS;

  let companyFirstDays = 0;
  let companyReason: PaymentReason = 'COMPANY_FIRST_DAYS';
  if (input.classification === 'INITIAL') {
    companyFirstDays = COMPANY_FIRST_DAYS[input.origin];
  } else if (
    input.chainRootStart &&
    getDaysBetween(input.chainRootStart, input.startDate) <= EXTENSION_COMPANY_WINDOW_DAYS
  ) {
    companyFirstDays = COMPANY_FIRST_DAYS[input.origin];
    companyReason = 'EXTENSION_WITHIN_30_DAYS';
  }

  const dayPayer = (dayOfInability: number, chainDay: number): [Payer, PaymentReason] => {
    if (isLicense) return ['EPS', 'LICENSE'];
    if (underMinContract) return ['COMPANY', 'CONTRACT_UNDER_28_DAYS'];
    if (dayOfInability <= companyFirstDays) return ['COMPANY', companyReason];
    if (input.origin === 'GENERAL' && chainDay >= PENSION_FUND_FROM_DAY && chainDay <= PENSION_FUND_TO_DAY) {
      return ['PENSION_FUND', 'PENSION_FUND_181_540'];
    }
    if (input.origin === 'GENERAL' && chainDay > PENSION_FUND_TO_DAY) return ['EPS', 'OVER_540_DAYS'];
    return [entity, 'ENTITY'];
  };

  const start = toColombianDateOnly(input.startDate);
  const segments: PaymentSegment[] = [];
  for (let day = 1; day <= input.days; day++) {
    const chainDay = input.chainDaysBefore + day;
    const [payer, reason] = dayPayer(day, chainDay);
    const date = formatColombianISODate(addColombianDays(start, day - 1));
    const last = segments[segments.length - 1];
    if (last && last.payer === payer && last.reason === reason) {
      last.to = date;
      last.days++;
      last.chainDayTo = chainDay;
    } else {
      segments.push({ from: date, to: date, days: 1, chainDayFrom: chainDay, chainDayTo: chainDay, payer, reason });
    }
  }

  const sum = (payer: Payer) => segments.filter((s) => s.payer === payer).reduce((t, s) => t + s.days, 0);
  return {
    entity,
    companyDays: sum('COMPANY'),
    entityDays: sum(entity),
    pensionFundDays: sum('PENSION_FUND'),
    segments,
  };
}

export function deadlines(startDate: Date, ipsInNetwork: boolean | null | undefined) {
  const start = toColombianDateOnly(startDate);
  return {
    filingDeadline:
      ipsInNetwork === null || ipsInNetwork === undefined
        ? null
        : addColombianDays(start, ipsInNetwork ? FILING_DAYS_IN_NETWORK : FILING_DAYS_OUT_OF_NETWORK),
    recoveryDeadline: addColombianMonths(start, RECOVERY_MONTHS),
  };
}
