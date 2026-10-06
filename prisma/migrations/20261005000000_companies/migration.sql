-- companies, and move every existing row into the default company
CREATE TABLE "Company" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Company_slug_key" ON "Company"("slug");
INSERT INTO "Company" ("id", "name", "slug", "updatedAt") VALUES ('default', 'My Company', 'default', CURRENT_TIMESTAMP);

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'Settings','Admin','Category','KnowledgeEntry','Department','TeamMember','Conversation','Message',
    'Ticket','Tag','ConversationTag','CallLog','Channel','Schedule','Webhook','WebhookDelivery',
    'ActivityLog','SLARule','CannedResponse','Customer','CustomerNote','AutomationRule','BusinessHours',
    'ApiKey','InternalNote','Campaign','Flow'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN "companyId" TEXT NOT NULL DEFAULT %L', t, 'default');
    EXECUTE format('ALTER TABLE %I ALTER COLUMN "companyId" SET DEFAULT %L', t, '');
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE',
      t, t || '_companyId_fkey');
    IF t <> 'Settings' THEN
      EXECUTE format('CREATE INDEX %I ON %I ("companyId")', t || '_companyId_idx', t);
    END IF;
  END LOOP;
END $$;

CREATE UNIQUE INDEX "Settings_companyId_key" ON "Settings"("companyId");

DROP INDEX "Tag_name_key";
CREATE UNIQUE INDEX "Tag_companyId_name_key" ON "Tag"("companyId", "name");

DROP INDEX "Channel_type_key";
CREATE UNIQUE INDEX "Channel_companyId_type_key" ON "Channel"("companyId", "type");

-- Settings.id is now a client-side uuid
ALTER TABLE "Settings" ALTER COLUMN "id" DROP DEFAULT;
