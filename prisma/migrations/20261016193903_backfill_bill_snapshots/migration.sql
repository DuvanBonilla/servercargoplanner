-- Backfill de snapshots para las Bill/BillDetail que existían antes de BillTariffSnapshot y
-- BillDetailSnapshot. Se ejecuta automáticamente con `prisma migrate deploy`.
--
-- Es una APROXIMACIÓN: lo que se usó al crear una Bill vieja no quedó registrado, así que
-- el snapshot congela la tarifa que tiene HOY el servicio de la Bill (is_backfilled = true)
-- y los valores actuales de cada BillDetail. Las Bill creadas con el código nuevo ya traen
-- su snapshot real y no se tocan. Es idempotente: solo inserta/actualiza lo que falta.

-- 1) BillTariffSnapshot para cada Bill que no lo tiene.
--    Tarifa = la del primer BillDetail con trabajador con tarifa; si la Bill no tiene
--    detalles, la de un trabajador del mismo grupo/operación. Sin tarifa resoluble, se omite
--    (esa Bill sigue recalculándose con la tarifa en vivo).
INSERT INTO "BillTariffSnapshot" (
  "id_bill", "id_tariff", "code",
  "id_subtask", "subTaskName",
  "id_costCenter", "costCenterName", "costCenterCode",
  "id_unidOfMeasure", "unitOfMeasureName",
  "id_facturation_unit", "facturationUnitName",
  "paysheet_tariff", "facturation_tariff",
  "full_tariff", "compensatory", "isSpecial", "alternative_paid_service", "group_tariff", "settle_payment",
  "status", "agreed_hours",
  "OD", "ON", "ED", "EN", "FOD", "FON", "FED", "FEN",
  "FAC_OD", "FAC_ON", "FAC_ED", "FAC_EN", "FAC_FOD", "FAC_FON", "FAC_FED", "FAC_FEN",
  "worked_HOD", "worked_HON", "worked_HED", "worked_HEN", "worked_HFOD", "worked_HFON", "worked_HFED", "worked_HFEN",
  "worked_FAC_HOD", "worked_FAC_HON", "worked_FAC_HED", "worked_FAC_HEN", "worked_FAC_HFOD", "worked_FAC_HFON", "worked_FAC_HFED", "worked_FAC_HFEN",
  "is_backfilled", "createdAt", "updatedAt"
)
SELECT
  b."id", t."id", t."code",
  t."id_subtask", st."name",
  t."id_costCenter", cc."name", cc."code",
  t."id_unidOfMeasure", uom."name",
  t."id_facturation_unit", fuom."name",
  t."paysheet_tariff", t."facturation_tariff",
  t."full_tariff", t."compensatory", t."isSpecial", t."alternative_paid_service", t."group_tariff", t."settle_payment",
  t."status", t."agreed_hours",
  t."OD", t."ON", t."ED", t."EN", t."FOD", t."FON", t."FED", t."FEN",
  t."FAC_OD", t."FAC_ON", t."FAC_ED", t."FAC_EN", t."FAC_FOD", t."FAC_FON", t."FAC_FED", t."FAC_FEN",
  b."HOD", b."HON", b."HED", b."HEN", b."HFOD", b."HFON", b."HFED", b."HFEN",
  b."FAC_HOD", b."FAC_HON", b."FAC_HED", b."FAC_HEN", b."FAC_HFOD", b."FAC_HFON", b."FAC_HFED", b."FAC_HFEN",
  true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Bill" b
JOIN LATERAL (
  SELECT x."id_tariff"
  FROM (
    SELECT ow."id_tariff", 1 AS "prio", d."id" AS "ord"
    FROM "BillDetail" d
    JOIN "Operation_Worker" ow ON ow."id" = d."id_operation_worker"
    WHERE d."id_bill" = b."id" AND ow."id_tariff" IS NOT NULL
    UNION ALL
    SELECT ow."id_tariff", 2 AS "prio", ow."id" AS "ord"
    FROM "Operation_Worker" ow
    WHERE ow."id_operation" = b."id_operation"
      AND ow."id_group" = b."id_group"
      AND ow."id_tariff" IS NOT NULL
  ) x
  ORDER BY x."prio", x."ord"
  LIMIT 1
) src ON true
JOIN "Tariff" t ON t."id" = src."id_tariff"
LEFT JOIN "SubTask" st ON st."id" = t."id_subtask"
LEFT JOIN "CostCenter" cc ON cc."id" = t."id_costCenter"
LEFT JOIN "UnitOfMeasure" uom ON uom."id" = t."id_unidOfMeasure"
LEFT JOIN "UnitOfMeasure" fuom ON fuom."id" = t."id_facturation_unit"
WHERE NOT EXISTS (SELECT 1 FROM "BillTariffSnapshot" s WHERE s."id_bill" = b."id");

-- 2) Completar las horas trabajadas (worked_*) de snapshots que las tienen vacías.
UPDATE "BillTariffSnapshot" s
SET
  "worked_HOD" = b."HOD", "worked_HON" = b."HON", "worked_HED" = b."HED", "worked_HEN" = b."HEN",
  "worked_HFOD" = b."HFOD", "worked_HFON" = b."HFON", "worked_HFED" = b."HFED", "worked_HFEN" = b."HFEN",
  "worked_FAC_HOD" = b."FAC_HOD", "worked_FAC_HON" = b."FAC_HON", "worked_FAC_HED" = b."FAC_HED", "worked_FAC_HEN" = b."FAC_HEN",
  "worked_FAC_HFOD" = b."FAC_HFOD", "worked_FAC_HFON" = b."FAC_HFON", "worked_FAC_HFED" = b."FAC_HFED", "worked_FAC_HFEN" = b."FAC_HFEN"
FROM "Bill" b
WHERE b."id" = s."id_bill" AND s."worked_HOD" IS NULL AND b."HOD" IS NOT NULL;

-- 3) BillDetailSnapshot para cada BillDetail que no lo tiene.
INSERT INTO "BillDetailSnapshot" (
  "id_bill_detail", "id_bill", "id_operation_worker",
  "workerName", "workerDni",
  "pay_unit", "pay_rate", "total_bill", "total_paysheet",
  "createdAt"
)
SELECT
  d."id", d."id_bill", d."id_operation_worker",
  w."name", w."dni",
  d."pay_unit", d."pay_rate", d."total_bill", d."total_paysheet",
  CURRENT_TIMESTAMP
FROM "BillDetail" d
LEFT JOIN "Operation_Worker" ow ON ow."id" = d."id_operation_worker"
LEFT JOIN "Worker" w ON w."id" = ow."id_worker"
WHERE NOT EXISTS (SELECT 1 FROM "BillDetailSnapshot" s WHERE s."id_bill_detail" = d."id");
