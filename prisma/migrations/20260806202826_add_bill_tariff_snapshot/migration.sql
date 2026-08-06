-- CreateTable
CREATE TABLE "BillTariffSnapshot" (
    "id" SERIAL NOT NULL,
    "id_bill" INTEGER NOT NULL,
    "id_tariff" INTEGER,
    "code" TEXT,
    "id_subtask" INTEGER,
    "subTaskName" TEXT,
    "id_costCenter" INTEGER,
    "costCenterName" TEXT,
    "costCenterCode" TEXT,
    "id_unidOfMeasure" INTEGER,
    "unitOfMeasureName" TEXT,
    "id_facturation_unit" INTEGER,
    "facturationUnitName" TEXT,
    "paysheet_tariff" DECIMAL(15,3) NOT NULL,
    "facturation_tariff" DECIMAL(15,3) NOT NULL,
    "full_tariff" "YES_NO" NOT NULL,
    "compensatory" "YES_NO" NOT NULL,
    "isSpecial" "YES_NO",
    "alternative_paid_service" "YES_NO" NOT NULL,
    "group_tariff" "YES_NO" NOT NULL,
    "settle_payment" "YES_NO" NOT NULL,
    "status" "StatusActivation",
    "agreed_hours" DECIMAL(15,3),
    "OD" DECIMAL(15,3) NOT NULL,
    "ON" DECIMAL(15,3) NOT NULL,
    "ED" DECIMAL(15,3) NOT NULL,
    "EN" DECIMAL(15,3) NOT NULL,
    "FOD" DECIMAL(15,3) NOT NULL,
    "FON" DECIMAL(15,3) NOT NULL,
    "FED" DECIMAL(15,3) NOT NULL,
    "FEN" DECIMAL(15,3) NOT NULL,
    "FAC_OD" DECIMAL(15,3) NOT NULL,
    "FAC_ON" DECIMAL(15,3) NOT NULL,
    "FAC_ED" DECIMAL(15,3) NOT NULL,
    "FAC_EN" DECIMAL(15,3) NOT NULL,
    "FAC_FOD" DECIMAL(15,3) NOT NULL,
    "FAC_FON" DECIMAL(15,3) NOT NULL,
    "FAC_FED" DECIMAL(15,3) NOT NULL,
    "FAC_FEN" DECIMAL(15,3) NOT NULL,
    "is_backfilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BillTariffSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillTariffSnapshot_id_bill_key" ON "BillTariffSnapshot"("id_bill");

-- CreateIndex
CREATE INDEX "BillTariffSnapshot_id_tariff_idx" ON "BillTariffSnapshot"("id_tariff");

-- AddForeignKey
ALTER TABLE "BillTariffSnapshot" ADD CONSTRAINT "BillTariffSnapshot_id_bill_fkey" FOREIGN KEY ("id_bill") REFERENCES "Bill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
