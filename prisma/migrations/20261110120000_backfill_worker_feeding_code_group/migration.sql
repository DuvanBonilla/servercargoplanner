-- Rellena code_group en las alimentaciones de TRABAJADOR existentes, para
-- saber en qué grupo se le dio la alimentación (un trabajador puede estar en
-- varios grupos de la misma operación). No crea ni elimina columnas: solo
-- reutiliza datos que ya existen:
--   - Operation_Worker: en qué grupo (id_group) está el trabajador en esa operación.
--   - OperationGroup:   código (code) de ese id_group en esa operación.
--
-- Solo se rellena cuando NO hay duda: el trabajador está en UN ÚNICO grupo de
-- esa operación y ese grupo tiene un código numérico en OperationGroup. Si el
-- trabajador estaba en varios grupos, el registro queda en NULL y se sigue
-- contando como antes (por operación + trabajador), sin alterar el histórico.
--
-- No toca:
--   - la alimentación extra del grupo (id_worker NULL), que ya tiene code_group;
--   - registros que ya tienen code_group.

WITH single_group AS (
  SELECT ow."id_operation", ow."id_worker", MIN(ow."id_group") AS "id_group"
  FROM "Operation_Worker" ow
  WHERE ow."id_group" IS NOT NULL
  GROUP BY ow."id_operation", ow."id_worker"
  HAVING COUNT(DISTINCT ow."id_group") = 1
)
UPDATE "WorkerFeeding" wf
SET "code_group" = og."code"::INTEGER
FROM single_group sg
JOIN "OperationGroup" og
  ON og."id_operation" = sg."id_operation"
 AND og."id_group" = sg."id_group"
WHERE wf."id_worker" IS NOT NULL
  AND wf."code_group" IS NULL
  AND sg."id_operation" = wf."id_operation"
  AND sg."id_worker" = wf."id_worker"
  AND og."code" ~ '^[0-9]{1,9}$';
