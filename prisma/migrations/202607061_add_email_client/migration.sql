/*
  Warnings:

  - Added the required enum `ClientEmailType`.
  - Created the `ClientEmail` table.
*/

-- ==========================================
-- ENUM
-- ==========================================

CREATE TYPE "ClientEmailType" AS ENUM (
    'LIQUIDATION',
    'SUPERVISOR'
);

-- ==========================================
-- TABLE
-- ==========================================

CREATE TABLE "ClientEmail" (
    "id" SERIAL NOT NULL,
    "id_client" INTEGER NOT NULL,
    "email" TEXT NOT NULL,
    "type" "ClientEmailType" NOT NULL,
    "name" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT TRUE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientEmail_pkey" PRIMARY KEY ("id"),

    CONSTRAINT "ClientEmail_id_client_fkey"
        FOREIGN KEY ("id_client")
        REFERENCES "Client"("id")
        ON DELETE CASCADE
        ON UPDATE CASCADE
);

-- ==========================================
-- UNIQUE
-- Evita que un cliente registre dos veces
-- el mismo correo.
-- ==========================================

CREATE UNIQUE INDEX "ClientEmail_id_client_email_key"
ON "ClientEmail" ("id_client", "email");

-- ==========================================
-- INDEXES
-- ==========================================

CREATE INDEX "ClientEmail_id_client_idx"
ON "ClientEmail" ("id_client");

CREATE INDEX "ClientEmail_type_idx"
ON "ClientEmail" ("type");