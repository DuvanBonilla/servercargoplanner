-- CreateEnum
CREATE TYPE "WorkerType" AS ENUM ('OPERATIVE', 'ADMINISTRATIVE');

-- CreateTable
CREATE TABLE "WorkerContract" (
    "id" SERIAL NOT NULL,
    "id_worker" INTEGER NOT NULL,
    "id_company" INTEGER,
    "startDate" DATE,
    "endDate" DATE,
    "workerType" "WorkerType",
    "isLegacy" BOOLEAN NOT NULL DEFAULT false,
    "id_user" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkerContract_pkey" PRIMARY KEY ("id"),
    -- Un contrato normal tiene todos sus datos; solo el histórico legacy puede quedar incompleto
    CONSTRAINT "WorkerContract_complete_chk" CHECK (
        "isLegacy" OR ("id_company" IS NOT NULL AND "startDate" IS NOT NULL AND "endDate" IS NOT NULL AND "workerType" IS NOT NULL)
    ),
    CONSTRAINT "WorkerContract_dates_chk" CHECK (
        "startDate" IS NULL OR "endDate" IS NULL OR "startDate" <= "endDate"
    )
);

-- CreateIndex
CREATE INDEX "WorkerContract_id_worker_idx" ON "WorkerContract"("id_worker");

-- CreateIndex
CREATE INDEX "WorkerContract_id_company_idx" ON "WorkerContract"("id_company");

-- CreateIndex
CREATE INDEX "WorkerContract_id_user_idx" ON "WorkerContract"("id_user");

-- CreateIndex
CREATE INDEX "WorkerContract_endDate_idx" ON "WorkerContract"("endDate");

-- AddForeignKey
ALTER TABLE "WorkerContract" ADD CONSTRAINT "WorkerContract_id_worker_fkey" FOREIGN KEY ("id_worker") REFERENCES "Worker"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerContract" ADD CONSTRAINT "WorkerContract_id_company_fkey" FOREIGN KEY ("id_company") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkerContract" ADD CONSTRAINT "WorkerContract_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
