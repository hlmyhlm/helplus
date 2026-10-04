ALTER TABLE "Settings" ADD COLUMN "aiBaseUrl" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN "embedProvider" TEXT NOT NULL DEFAULT 'openai';
ALTER TABLE "Settings" ADD COLUMN "embedModel" TEXT NOT NULL DEFAULT 'text-embedding-3-small';
ALTER TABLE "Settings" ADD COLUMN "embedApiKey" TEXT NOT NULL DEFAULT '';
ALTER TABLE "Settings" ADD COLUMN "embedBaseUrl" TEXT NOT NULL DEFAULT '';
