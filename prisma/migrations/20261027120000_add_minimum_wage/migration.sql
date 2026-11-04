-- CreateTable
CREATE TABLE "MinimumWage" (
    "id" SERIAL NOT NULL,
    "year" INTEGER NOT NULL,
    "value" INTEGER NOT NULL,
    "id_user" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MinimumWage_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MinimumWage_value_chk" CHECK ("value" > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "MinimumWage_year_key" ON "MinimumWage"("year");

-- CreateIndex
CREATE INDEX "MinimumWage_id_user_idx" ON "MinimumWage"("id_user");

-- AddForeignKey
ALTER TABLE "MinimumWage" ADD CONSTRAINT "MinimumWage_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
