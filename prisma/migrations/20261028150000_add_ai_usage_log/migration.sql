-- Consumo de modelos de IA (tokens y costo por llamada)
-- CreateTable
CREATE TABLE "AiUsageLog" (
    "id" SERIAL NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "totalTokens" INTEGER NOT NULL,
    "costUsd" DECIMAL(12,6) NOT NULL,
    "id_user" INTEGER NOT NULL,
    "id_worker" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsageLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AiUsageLog_createdAt_idx" ON "AiUsageLog"("createdAt");

-- CreateIndex
CREATE INDEX "AiUsageLog_id_user_idx" ON "AiUsageLog"("id_user");

-- CreateIndex
CREATE INDEX "AiUsageLog_id_worker_idx" ON "AiUsageLog"("id_worker");

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiUsageLog" ADD CONSTRAINT "AiUsageLog_id_worker_fkey" FOREIGN KEY ("id_worker") REFERENCES "Worker"("id") ON DELETE SET NULL ON UPDATE CASCADE;

