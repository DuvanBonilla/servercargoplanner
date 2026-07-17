-- CreateTable
CREATE TABLE "OperationGroup" (
    "id" SERIAL NOT NULL,
    "id_operation" INTEGER NOT NULL,
    "id_group" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "alias" INTEGER NOT NULL,
    "createAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OperationGroup_id_operation_id_group_key" ON "OperationGroup"("id_operation", "id_group");

-- CreateIndex
CREATE UNIQUE INDEX "OperationGroup_id_operation_alias_key" ON "OperationGroup"("id_operation", "alias");

-- AddForeignKey
ALTER TABLE "OperationGroup" ADD CONSTRAINT "OperationGroup_id_operation_fkey" FOREIGN KEY ("id_operation") REFERENCES "Operation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: numerar los grupos existentes por orden de creacion (min id de Operation_Worker por id_group)
-- y generar el code = id_operation + alias (numero de grupo) con 2 digitos (ej. 14379 -> 1437901, 1437902...)
INSERT INTO "OperationGroup" ("id_operation", "id_group", "alias", "code")
SELECT
    sub.id_operation,
    sub.id_group,
    sub."alias",
    sub.id_operation::text || LPAD(sub."alias"::text, 2, '0') AS code
FROM (
    SELECT
        ow.id_operation,
        ow.id_group,
        ROW_NUMBER() OVER (PARTITION BY ow.id_operation ORDER BY MIN(ow.id) ASC) AS "alias"
    FROM "Operation_Worker" ow
    WHERE ow.id_group IS NOT NULL
    GROUP BY ow.id_operation, ow.id_group
) sub;
