-- AlterTable
ALTER TABLE "Company" ADD COLUMN     "id_arl" INTEGER;

-- CreateIndex
CREATE INDEX "Company_id_arl_idx" ON "Company"("id_arl");

-- AddForeignKey
ALTER TABLE "Company" ADD CONSTRAINT "Company_id_arl_fkey" FOREIGN KEY ("id_arl") REFERENCES "Arl"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
