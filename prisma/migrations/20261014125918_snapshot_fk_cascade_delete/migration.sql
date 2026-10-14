-- Las FK de los snapshots pasan a ON DELETE CASCADE: al borrar una Bill (o un
-- BillDetail de un trabajador removido) su snapshot se elimina con ella, en vez
-- de bloquear el borrado con RESTRICT.

-- DropForeignKey
ALTER TABLE "BillTariffSnapshot" DROP CONSTRAINT IF EXISTS "BillTariffSnapshot_id_bill_fkey";

-- AddForeignKey
ALTER TABLE "BillTariffSnapshot" ADD CONSTRAINT "BillTariffSnapshot_id_bill_fkey" FOREIGN KEY ("id_bill") REFERENCES "Bill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- DropForeignKey
ALTER TABLE "BillDetailSnapshot" DROP CONSTRAINT IF EXISTS "BillDetailSnapshot_id_bill_detail_fkey";

-- AddForeignKey
ALTER TABLE "BillDetailSnapshot" ADD CONSTRAINT "BillDetailSnapshot_id_bill_detail_fkey" FOREIGN KEY ("id_bill_detail") REFERENCES "BillDetail"("id") ON DELETE CASCADE ON UPDATE CASCADE;
