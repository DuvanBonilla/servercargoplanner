-- Un certificado puede traer varios diagnósticos relacionados (3, 4 o más): se
-- guardan todos, porque la prórroga se detecta por cualquiera de ellos.
-- AlterTable
ALTER TABLE "Inability" ADD COLUMN "diagnosesRelated" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "Inability" SET "diagnosesRelated" = ARRAY["diagnosisRelated"]
WHERE "diagnosisRelated" IS NOT NULL AND "diagnosisRelated" <> '';

ALTER TABLE "Inability" DROP COLUMN "diagnosisRelated";
