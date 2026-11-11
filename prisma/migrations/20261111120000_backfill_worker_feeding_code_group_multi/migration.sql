-- Completa code_group en las alimentaciones de TRABAJADOR que la migración
-- 20261110120000_backfill_worker_feeding_code_group dejó en NULL porque el
-- trabajador estaba en VARIOS grupos de la misma operación. No crea ni elimina
-- columnas: solo reutiliza datos que ya existen:
--   - Operation_Worker: en qué grupos (id_group) está el trabajador en esa operación.
--   - OperationGroup:   código (code) y número visible (alias) de cada id_group.
--
-- Regla:
--   - Trabajador en UN solo grupo de la operación: ese grupo (ya lo cubría la
--     migración anterior; aquí se repite por si quedó alguno pendiente).
--   - Trabajador en VARIOS grupos de la misma operación (decisión de negocio):
--     el PRIMER grupo, es decir, el de menor alias (Grupo 1, luego 2, ...).
--
-- Es segura de ejecutar después de la migración anterior: solo actualiza
-- registros con code_group en NULL, así que no cambia lo ya rellenado.
--
-- No toca:
--   - la alimentación extra del grupo (id_worker NULL), que ya tiene code_group;
--   - registros que ya tienen code_group (los nuevos se guardan al registrar).

WITH worker_groups AS (
  SELECT DISTINCT ow."id_operation", ow."id_worker", og."code", og."alias"
  FROM "Operation_Worker" ow
  JOIN "OperationGroup" og
    ON og."id_operation" = ow."id_operation"
   AND og."id_group" = ow."id_group"
  WHERE ow."id_group" IS NOT NULL
    AND og."code" ~ '^[0-9]{1,9}$'
),
first_group AS (
  SELECT DISTINCT ON ("id_operation", "id_worker")
         "id_operation", "id_worker", "code"
  FROM worker_groups
  ORDER BY "id_operation", "id_worker", "alias" ASC
)
UPDATE "WorkerFeeding" wf
SET "code_group" = fg."code"::INTEGER
FROM first_group fg
WHERE wf."id_worker" IS NOT NULL
  AND wf."code_group" IS NULL
  AND fg."id_operation" = wf."id_operation"
  AND fg."id_worker" = wf."id_worker";
