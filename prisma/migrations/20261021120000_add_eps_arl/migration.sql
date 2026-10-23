-- CreateTable
CREATE TABLE "Eps" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nit" TEXT NOT NULL,
    "status" "StatusActivation" NOT NULL DEFAULT 'ACTIVE',
    "id_user" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Eps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Arl" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nit" TEXT NOT NULL,
    "status" "StatusActivation" NOT NULL DEFAULT 'ACTIVE',
    "id_user" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Arl_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Eps_name_key" ON "Eps"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Eps_nit_key" ON "Eps"("nit");

-- CreateIndex
CREATE INDEX "Eps_id_user_idx" ON "Eps"("id_user");

-- CreateIndex
CREATE UNIQUE INDEX "Arl_name_key" ON "Arl"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Arl_nit_key" ON "Arl"("nit");

-- CreateIndex
CREATE INDEX "Arl_id_user_idx" ON "Arl"("id_user");

-- AddForeignKey
ALTER TABLE "Eps" ADD CONSTRAINT "Eps_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Arl" ADD CONSTRAINT "Arl_id_user_fkey" FOREIGN KEY ("id_user") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

