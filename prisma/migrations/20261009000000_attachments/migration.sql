ALTER TABLE "Settings" ADD COLUMN "originalRetentionDays" INTEGER NOT NULL DEFAULT 90;

CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "ticketId" TEXT NOT NULL,
    "messageId" TEXT,
    "fileName" TEXT NOT NULL DEFAULT 'screenshot.png',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "originalKey" TEXT,
    "maskedKey" TEXT,
    "width" INTEGER NOT NULL DEFAULT 0,
    "height" INTEGER NOT NULL DEFAULT 0,
    "icCount" INTEGER NOT NULL DEFAULT 0,
    "ocrConfidence" INTEGER,
    "autoBoxes" JSONB NOT NULL DEFAULT '[]',
    "manualBoxes" JSONB NOT NULL DEFAULT '[]',
    "checkNote" TEXT NOT NULL DEFAULT '',
    "checkedById" TEXT,
    "checkedAt" TIMESTAMP(3),
    "originalDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Attachment_companyId_status_idx" ON "Attachment"("companyId", "status");
CREATE INDEX "Attachment_ticketId_idx" ON "Attachment"("ticketId");
CREATE INDEX "Attachment_messageId_idx" ON "Attachment"("messageId");
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_checkedById_fkey" FOREIGN KEY ("checkedById") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
