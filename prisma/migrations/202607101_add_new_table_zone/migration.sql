CREATE TABLE "Zone" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "id_user" INTEGER NOT NULL,
    "status" "StatusActivation" NOT NULL DEFAULT 'ACTIVE',
    "id_site" INTEGER NOT NULL DEFAULT 1,
    "id_subsite" INTEGER,

    CONSTRAINT "Zone_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Zone" ADD CONSTRAINT "Zone_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_id_site_fkey" FOREIGN KEY ("id_site") REFERENCES "Site"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Zone" ADD CONSTRAINT "Zone_id_subsite_fkey" FOREIGN KEY ("id_subsite") REFERENCES "SubSite"("id") ON DELETE SET NULL ON UPDATE CASCADE;