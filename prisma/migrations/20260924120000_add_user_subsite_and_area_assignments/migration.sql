-- CreateTable
CREATE TABLE "UserSubSite" (
    "id_user" INTEGER NOT NULL,
    "id_subsite" INTEGER NOT NULL,

    CONSTRAINT "UserSubSite_pkey" PRIMARY KEY ("id_user","id_subsite")
);

-- CreateTable
CREATE TABLE "UserJobArea" (
    "id_user" INTEGER NOT NULL,
    "id_area" INTEGER NOT NULL,

    CONSTRAINT "UserJobArea_pkey" PRIMARY KEY ("id_user","id_area")
);

-- CreateIndex
CREATE INDEX "UserSubSite_id_subsite_idx" ON "UserSubSite"("id_subsite");

-- CreateIndex
CREATE INDEX "UserJobArea_id_area_idx" ON "UserJobArea"("id_area");

-- AddForeignKey
ALTER TABLE "UserSubSite" ADD CONSTRAINT "UserSubSite_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSubSite" ADD CONSTRAINT "UserSubSite_id_subsite_fkey" FOREIGN KEY ("id_subsite") REFERENCES "SubSite"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobArea" ADD CONSTRAINT "UserJobArea_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserJobArea" ADD CONSTRAINT "UserJobArea_id_area_fkey" FOREIGN KEY ("id_area") REFERENCES "JobArea"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: cada usuario existente conserva su subsede actual como asignación
INSERT INTO "UserSubSite" ("id_user", "id_subsite")
SELECT "id", "id_subsite" FROM "User" WHERE "id_subsite" IS NOT NULL;
