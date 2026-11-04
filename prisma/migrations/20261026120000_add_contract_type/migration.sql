-- CreateEnum
CREATE TYPE "ContractType" AS ENUM ('OBRA_LABOR', 'FIXED_13_WEEKS', 'FIXED_3_MONTHS', 'INDEFINITE', 'APPRENTICESHIP');

-- AlterTable
ALTER TABLE "WorkerContract" ADD COLUMN     "contractType" "ContractType";

-- Un contrato normal tiene empresa, inicio, tipo de trabajador y modalidad;
-- la fecha de terminación es obligatoria salvo en INDEFINITE (se llena al cerrarlo).
-- NOT VALID: aplica a registros nuevos/editados sin romper los existentes sin modalidad.
ALTER TABLE "WorkerContract" DROP CONSTRAINT "WorkerContract_complete_chk";
ALTER TABLE "WorkerContract" ADD CONSTRAINT "WorkerContract_complete_chk" CHECK (
    "isLegacy" OR (
        "id_company" IS NOT NULL AND "startDate" IS NOT NULL AND "workerType" IS NOT NULL
        AND "contractType" IS NOT NULL
        AND ("endDate" IS NOT NULL OR "contractType" = 'INDEFINITE')
    )
) NOT VALID;
