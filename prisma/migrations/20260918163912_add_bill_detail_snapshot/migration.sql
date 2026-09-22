-- AlterTable
ALTER TABLE "BillTariffSnapshot" ADD COLUMN     "worked_HOD" DECIMAL(15,3),
ADD COLUMN     "worked_HON" DECIMAL(15,3),
ADD COLUMN     "worked_HED" DECIMAL(15,3),
ADD COLUMN     "worked_HEN" DECIMAL(15,3),
ADD COLUMN     "worked_HFOD" DECIMAL(15,3),
ADD COLUMN     "worked_HFON" DECIMAL(15,3),
ADD COLUMN     "worked_HFED" DECIMAL(15,3),
ADD COLUMN     "worked_HFEN" DECIMAL(15,3),
ADD COLUMN     "worked_FAC_HOD" DECIMAL(15,3),
ADD COLUMN     "worked_FAC_HON" DECIMAL(15,3),
ADD COLUMN     "worked_FAC_HED" DECIMAL(15,3),
ADD COLUMN     "worked_FAC_HEN" DECIMAL(15,3),
ADD COLUMN     "worked_FAC_HFOD" DECIMAL(15,3),
ADD COLUMN     "worked_FAC_HFON" DECIMAL(15,3),
ADD COLUMN     "worked_FAC_HFED" DECIMAL(15,3),
ADD COLUMN     "worked_FAC_HFEN" DECIMAL(15,3);

-- CreateTable
CREATE TABLE "BillDetailSnapshot" (
    "id" SERIAL NOT NULL,
    "id_bill_detail" INTEGER NOT NULL,
    "id_bill" INTEGER NOT NULL,
    "id_operation_worker" INTEGER NOT NULL,
    "workerName" TEXT,
    "workerDni" TEXT,
    "pay_unit" DECIMAL(15,3),
    "pay_rate" DECIMAL(15,3),
    "total_bill" DECIMAL(15,3),
    "total_paysheet" DECIMAL(15,3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillDetailSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BillDetailSnapshot_id_bill_detail_key" ON "BillDetailSnapshot"("id_bill_detail");

-- CreateIndex
CREATE INDEX "BillDetailSnapshot_id_bill_idx" ON "BillDetailSnapshot"("id_bill");

-- CreateIndex
CREATE INDEX "BillDetailSnapshot_id_operation_worker_idx" ON "BillDetailSnapshot"("id_operation_worker");

-- AddForeignKey
ALTER TABLE "BillDetailSnapshot" ADD CONSTRAINT "BillDetailSnapshot_id_bill_detail_fkey" FOREIGN KEY ("id_bill_detail") REFERENCES "BillDetail"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
