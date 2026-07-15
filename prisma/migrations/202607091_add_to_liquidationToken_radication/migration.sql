-- Recreate TokenStatus enum: USED → CONFIRMED, add REJECTED
CREATE TYPE "TokenStatus_new" AS ENUM ('ACTIVE', 'CONFIRMED', 'REJECTED', 'EXPIRED');

ALTER TABLE "Token" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Token" ALTER COLUMN "status" TYPE "TokenStatus_new"
USING (CASE WHEN "status"::text = 'USED' THEN 'CONFIRMED' ELSE "status"::text END)::"TokenStatus_new";
ALTER TABLE "Token" ALTER COLUMN "status" SET DEFAULT 'ACTIVE'::"TokenStatus_new";

DROP TYPE "TokenStatus";
ALTER TYPE "TokenStatus_new" RENAME TO "TokenStatus";

-- TokenType enum for CONFIRMATION vs LIQUIDATION tokens
CREATE TYPE "TokenType" AS ENUM ('CONFIRMATION', 'LIQUIDATION');

-- Add type column to Token (existing tokens are CONFIRMATION)
ALTER TABLE "Token" ADD COLUMN "type" "TokenType" NOT NULL DEFAULT 'CONFIRMATION';

-- OperationConfirmation: boolean flag instead of registration number string
ALTER TABLE "OperationConfirmation" ADD COLUMN "fileCodeRegistered" BOOLEAN NOT NULL DEFAULT false;

-- Bill: file code string
ALTER TABLE "Bill" ADD COLUMN "fileCode" TEXT;


