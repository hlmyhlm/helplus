-- sla rules: channel becomes source, plus project and category overrides
ALTER TABLE "SLARule" RENAME COLUMN "channel" TO "source";
ALTER TABLE "SLARule" ADD COLUMN "projectId" TEXT, ADD COLUMN "category" TEXT NOT NULL DEFAULT 'all';
CREATE INDEX "SLARule_projectId_idx" ON "SLARule"("projectId");
ALTER TABLE "SLARule" ADD CONSTRAINT "SLARule_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- holidays
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "date" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Holiday_companyId_date_key" ON "Holiday"("companyId", "date");
CREATE INDEX "Holiday_companyId_idx" ON "Holiday"("companyId");
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- sla times on tickets
ALTER TABLE "Ticket"
  ADD COLUMN "slaRuleId" TEXT,
  ADD COLUMN "firstReplyWarnAt" TIMESTAMP(3),
  ADD COLUMN "firstReplyDueAt" TIMESTAMP(3),
  ADD COLUMN "resolveWarnAt" TIMESTAMP(3),
  ADD COLUMN "resolveDueAt" TIMESTAMP(3),
  ADD COLUMN "slaPausedAt" TIMESTAMP(3),
  ADD COLUMN "slaPausedMins" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "slaWarnedAt" TIMESTAMP(3),
  ADD COLUMN "slaBreachedAt" TIMESTAMP(3),
  ADD COLUMN "closeWarnedAt" TIMESTAMP(3);
CREATE INDEX "Ticket_slaRuleId_idx" ON "Ticket"("slaRuleId");
CREATE INDEX "Ticket_resolveDueAt_idx" ON "Ticket"("resolveDueAt");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_slaRuleId_fkey" FOREIGN KEY ("slaRuleId") REFERENCES "SLARule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- settings and users
ALTER TABLE "Settings" ADD COLUMN "autoCloseDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "Admin" ADD COLUMN "email" TEXT NOT NULL DEFAULT '', ADD COLUMN "notifyNew" BOOLEAN NOT NULL DEFAULT false;

-- email queue
CREATE TABLE "EmailOutbox" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "to" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "ticketId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT NOT NULL DEFAULT '',
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "EmailOutbox_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "EmailOutbox_companyId_status_nextAttemptAt_idx" ON "EmailOutbox"("companyId", "status", "nextAttemptAt");
CREATE INDEX "EmailOutbox_ticketId_idx" ON "EmailOutbox"("ticketId");
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "EmailOutbox" ADD CONSTRAINT "EmailOutbox_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
