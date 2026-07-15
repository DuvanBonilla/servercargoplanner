/* ============================================================
   1. Agregar nuevos valores a los ENUM existentes
   ============================================================ */

-- BillStatus
ALTER TYPE "BillStatus"
ADD VALUE IF NOT EXISTS 'TO_APPROVED';

-- StatusOperation
ALTER TYPE "StatusOperation"
ADD VALUE IF NOT EXISTS 'TO_APPROVED';

ALTER TYPE "StatusOperation"
ADD VALUE IF NOT EXISTS 'APPROVED';

ALTER TYPE "StatusOperation"
ADD VALUE IF NOT EXISTS 'REJECTED';


/* ============================================================
   2. Crear nuevo ENUM
   ============================================================ */

CREATE TYPE "TokenStatus" AS ENUM (
    'ACTIVE',
    'USED',
    'EXPIRED'
);


/* ============================================================
   3. Crear tabla OperationConfirmation
   ============================================================ */

CREATE TABLE "OperationConfirmation" (
    "id" SERIAL PRIMARY KEY,
    "id_operation" INTEGER NOT NULL UNIQUE,

    "ipAddress" TEXT,
    "device" TEXT,
    "clientObservation" TEXT,
    "supervisorObservation" TEXT,

    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "OperationConfirmation_id_operation_fkey"
        FOREIGN KEY ("id_operation")
        REFERENCES "Operation"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);


/* ============================================================
   4. Crear tabla Token
   ============================================================ */

CREATE TABLE "Token" (
    "id" SERIAL PRIMARY KEY,

    "id_confirmation" INTEGER NOT NULL,

    "tokenHash" TEXT NOT NULL UNIQUE,

    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    "status" "TokenStatus" NOT NULL DEFAULT 'ACTIVE',

    "usedAt" TIMESTAMP(3),

    CONSTRAINT "Token_id_confirmation_fkey"
        FOREIGN KEY ("id_confirmation")
        REFERENCES "OperationConfirmation"("id")
        ON DELETE RESTRICT
        ON UPDATE CASCADE
);


/* ============================================================
   5. Índices
   ============================================================ */

CREATE UNIQUE INDEX "OperationConfirmation_id_operation_key"
ON "OperationConfirmation"("id_operation");

CREATE UNIQUE INDEX "Token_tokenHash_key"
ON "Token"("tokenHash");