-- Permite registrar una alimentación asociada a un grupo (OperationGroup)
-- en lugar de a un trabajador específico. id_worker pasa a ser opcional y
-- se agrega code_group (código numérico de OperationGroup) para identificar
-- el grupo cuando la alimentación no pertenece a una persona puntual.

-- DropForeignKey
ALTER TABLE "WorkerFeeding" DROP CONSTRAINT "WorkerFeeding_id_worker_fkey";

-- AlterTable
ALTER TABLE "WorkerFeeding"
  ADD COLUMN "code_group" INTEGER,
  ALTER COLUMN "id_worker" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "WorkerFeeding_code_group_idx" ON "WorkerFeeding"("code_group");

-- AddForeignKey
ALTER TABLE "WorkerFeeding" ADD CONSTRAINT "WorkerFeeding_id_worker_fkey" FOREIGN KEY ("id_worker") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;
