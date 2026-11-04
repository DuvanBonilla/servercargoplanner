-- Contrato de trabajador reubicado: sigue vigente sin fecha de terminación.
-- Prórroga cuya incapacidad anterior está fuera del sistema: inicio de la cadena
-- y días acumulados digitados por el usuario.
-- AlterTable
ALTER TABLE "WorkerContract" ADD COLUMN "isRelocated" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Inability" ADD COLUMN "externalChainDays" INTEGER,
ADD COLUMN "externalChainStart" DATE;

ALTER TABLE "Inability" ADD CONSTRAINT "Inability_externalChain_check" CHECK (
  ("externalChainStart" IS NULL AND "externalChainDays" IS NULL)
  OR ("externalChainStart" IS NOT NULL AND "externalChainDays" >= 1)
);

-- Sin terminación: indefinido o reubicado (NOT VALID: el contrato 1 sigue sin contractType)
ALTER TABLE "WorkerContract" DROP CONSTRAINT "WorkerContract_complete_chk";
ALTER TABLE "WorkerContract" ADD CONSTRAINT "WorkerContract_complete_chk" CHECK (
    "isLegacy" OR (
        "id_company" IS NOT NULL AND "startDate" IS NOT NULL AND "workerType" IS NOT NULL
        AND "contractType" IS NOT NULL
        AND ("endDate" IS NOT NULL OR "contractType" = 'INDEFINITE' OR "isRelocated")
    )
) NOT VALID;
