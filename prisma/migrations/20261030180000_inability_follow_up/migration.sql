-- Seguimiento del recobro de cada incapacidad: estado actual, valor aprobado por la
-- entidad e historial de radicaciones, pagos, PQR, rechazos y notas.
-- CreateEnum
CREATE TYPE "InabilityRecoveryStatus" AS ENUM ('PENDING', 'FILED', 'IN_RECOVERY', 'PARTIALLY_PAID', 'PAID', 'REJECTED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "InabilityFollowUpType" AS ENUM ('FILING', 'PQR', 'PAYMENT', 'REJECTION', 'NOTE', 'DATA_CHANGE');

-- AlterTable
ALTER TABLE "Inability" ADD COLUMN "approvedAmount" DECIMAL(14,2),
ADD COLUMN "recoveryStatus" "InabilityRecoveryStatus" NOT NULL DEFAULT 'PENDING';

-- CreateTable
CREATE TABLE "InabilityFollowUp" (
    "id" SERIAL NOT NULL,
    "id_inability" INTEGER NOT NULL,
    "type" "InabilityFollowUpType" NOT NULL,
    "eventDate" DATE NOT NULL,
    "recoveryStatus" "InabilityRecoveryStatus" NOT NULL,
    "filingNumber" TEXT,
    "nail" TEXT,
    "pqrNumber" TEXT,
    "amount" DECIMAL(14,2),
    "days" INTEGER,
    "description" TEXT,
    "id_user" INTEGER NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InabilityFollowUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InabilityFollowUp_id_inability_idx" ON "InabilityFollowUp"("id_inability");

-- CreateIndex
CREATE INDEX "InabilityFollowUp_id_user_idx" ON "InabilityFollowUp"("id_user");

-- CreateIndex
CREATE INDEX "Inability_recoveryStatus_idx" ON "Inability"("recoveryStatus");

-- AddForeignKey
ALTER TABLE "InabilityFollowUp" ADD CONSTRAINT "InabilityFollowUp_id_inability_fkey" FOREIGN KEY ("id_inability") REFERENCES "Inability"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InabilityFollowUp" ADD CONSTRAINT "InabilityFollowUp_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lo que la empresa asume por completo no tiene nada que recobrar
UPDATE "Inability" SET "recoveryStatus" = 'NOT_APPLICABLE'
WHERE "companyDays" IS NOT NULL AND "entityDays" = 0 AND "pensionFundDays" = 0;
