-- Término fijo de 1 año o más (termina 2 días antes del vencimiento)
ALTER TYPE "ContractType" ADD VALUE IF NOT EXISTS 'FIXED_1_YEAR' AFTER 'FIXED_3_MONTHS';
