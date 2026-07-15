/*
  Cambia el campo isActive por status usando el enum StatusActivation
*/

-- Agregar la nueva columna
ALTER TABLE "ClientEmail"
ADD COLUMN "status" "StatusActivation" NOT NULL DEFAULT 'ACTIVE';

-- Migrar los datos existentes
UPDATE "ClientEmail"
SET "status" = CASE
    WHEN "isActive" = TRUE THEN 'ACTIVE'::"StatusActivation"
    ELSE 'INACTIVE'::"StatusActivation"
END;

-- Eliminar la columna anterior
ALTER TABLE "ClientEmail"
DROP COLUMN "isActive";

-- Índice para mejorar las consultas por estado
CREATE INDEX "ClientEmail_status_idx"
ON "ClientEmail" ("status");