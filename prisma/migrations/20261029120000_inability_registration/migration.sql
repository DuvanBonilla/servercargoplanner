-- Registro de incapacidades con certificado: origen, cadena de prórrogas,
-- datos del certificado, copia de contrato/empresa/EPS/ARL/IBC y liquidación
-- de días. Las 97 incapacidades existentes quedan con estos campos vacíos.
-- CreateEnum
CREATE TYPE "InabilityOrigin" AS ENUM ('GENERAL', 'LABOR', 'MATERNITY', 'PATERNITY');

-- AlterTable
ALTER TABLE "Inability" ADD COLUMN     "authorizationNumber" TEXT,
ADD COLUMN     "certificateNumber" TEXT,
ADD COLUMN     "certificateType" "TypeDisability",
ADD COLUMN     "chainDaysBefore" INTEGER,
ADD COLUMN     "companyDays" INTEGER,
ADD COLUMN     "contractDays" INTEGER,
ADD COLUMN     "days" INTEGER,
ADD COLUMN     "diagnosisPrincipal" TEXT,
ADD COLUMN     "diagnosisRelated" TEXT,
ADD COLUMN     "documentCheck" TEXT,
ADD COLUMN     "documentName" TEXT,
ADD COLUMN     "documentPath" TEXT,
ADD COLUMN     "entityDays" INTEGER,
ADD COLUMN     "entityFilingNumber" TEXT,
ADD COLUMN     "extractedData" JSONB,
ADD COLUMN     "filingDeadline" DATE,
ADD COLUMN     "ibc" INTEGER,
ADD COLUMN     "id_arl" INTEGER,
ADD COLUMN     "id_company" INTEGER,
ADD COLUMN     "id_contract" INTEGER,
ADD COLUMN     "id_eps" INTEGER,
ADD COLUMN     "id_extension_of" INTEGER,
ADD COLUMN     "ipsCode" TEXT,
ADD COLUMN     "ipsInNetwork" BOOLEAN,
ADD COLUMN     "ipsName" TEXT,
ADD COLUMN     "issueDate" DATE,
ADD COLUMN     "nail" TEXT,
ADD COLUMN     "observation" TEXT,
ADD COLUMN     "origin" "InabilityOrigin",
ADD COLUMN     "pensionFundDays" INTEGER,
ADD COLUMN     "professionalName" TEXT;

-- El IBC nunca es negativo ni cero; los días de liquidación tampoco son negativos
ALTER TABLE "Inability" ADD CONSTRAINT "Inability_ibc_check" CHECK ("ibc" IS NULL OR "ibc" > 0);
ALTER TABLE "Inability" ADD CONSTRAINT "Inability_days_check" CHECK (
  ("days" IS NULL OR "days" > 0) AND
  ("companyDays" IS NULL OR "companyDays" >= 0) AND
  ("entityDays" IS NULL OR "entityDays" >= 0) AND
  ("pensionFundDays" IS NULL OR "pensionFundDays" >= 0)
);

-- CreateIndex
CREATE INDEX "Inability_id_extension_of_idx" ON "Inability"("id_extension_of");

-- CreateIndex
CREATE INDEX "Inability_id_contract_idx" ON "Inability"("id_contract");

-- CreateIndex
CREATE INDEX "Inability_id_company_idx" ON "Inability"("id_company");

-- CreateIndex
CREATE INDEX "Inability_id_eps_idx" ON "Inability"("id_eps");

-- CreateIndex
CREATE INDEX "Inability_id_arl_idx" ON "Inability"("id_arl");

-- AddForeignKey
ALTER TABLE "Inability" ADD CONSTRAINT "Inability_id_extension_of_fkey" FOREIGN KEY ("id_extension_of") REFERENCES "Inability"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inability" ADD CONSTRAINT "Inability_id_contract_fkey" FOREIGN KEY ("id_contract") REFERENCES "WorkerContract"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inability" ADD CONSTRAINT "Inability_id_company_fkey" FOREIGN KEY ("id_company") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inability" ADD CONSTRAINT "Inability_id_eps_fkey" FOREIGN KEY ("id_eps") REFERENCES "Eps"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Inability" ADD CONSTRAINT "Inability_id_arl_fkey" FOREIGN KEY ("id_arl") REFERENCES "Arl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
