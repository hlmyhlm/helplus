ALTER TABLE "Ticket" ADD COLUMN "importKey" TEXT;
CREATE UNIQUE INDEX "Ticket_companyId_importKey_key" ON "Ticket"("companyId", "importKey");
ALTER TABLE "Message" ADD COLUMN "importKey" TEXT;
CREATE UNIQUE INDEX "Message_companyId_importKey_key" ON "Message"("companyId", "importKey");

ALTER TABLE "KnowledgeEntry"
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "status" TEXT NOT NULL DEFAULT 'approved',
  ADD COLUMN "sourceTicketId" TEXT;
CREATE INDEX "KnowledgeEntry_projectId_status_idx" ON "KnowledgeEntry"("projectId", "status");
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "KnowledgeEntry" ADD CONSTRAINT "KnowledgeEntry_sourceTicketId_fkey" FOREIGN KEY ("sourceTicketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "fileKey" TEXT,
    "fileName" TEXT NOT NULL DEFAULT '',
    "options" JSONB NOT NULL DEFAULT '{}',
    "preview" JSONB NOT NULL DEFAULT '{}',
    "progress" JSONB NOT NULL DEFAULT '{}',
    "stats" JSONB NOT NULL DEFAULT '{}',
    "badRows" JSONB NOT NULL DEFAULT '[]',
    "error" TEXT NOT NULL DEFAULT '',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ImportJob_companyId_status_idx" ON "ImportJob"("companyId", "status");
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ChatSender" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "ChatSender_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ChatSender_companyId_name_key" ON "ChatSender"("companyId", "name");
ALTER TABLE "ChatSender" ADD CONSTRAINT "ChatSender_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ImportMapping" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "headers" TEXT NOT NULL,
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ImportMapping_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ImportMapping_companyId_headers_key" ON "ImportMapping"("companyId", "headers");
ALTER TABLE "ImportMapping" ADD CONSTRAINT "ImportMapping_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
