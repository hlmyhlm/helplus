ALTER TABLE "BusinessHours" ALTER COLUMN "id" DROP DEFAULT;
DROP INDEX "BusinessHours_companyId_idx";
CREATE UNIQUE INDEX "BusinessHours_companyId_key" ON "BusinessHours"("companyId");
