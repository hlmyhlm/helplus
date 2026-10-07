CREATE TABLE "WaChat" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "waId" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "isGroup" BOOLEAN NOT NULL DEFAULT true,
    "projectId" TEXT,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WaChat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WaChat_companyId_waId_key" ON "WaChat"("companyId", "waId");
CREATE INDEX "WaChat_companyId_idx" ON "WaChat"("companyId");
ALTER TABLE "WaChat" ADD CONSTRAINT "WaChat_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaChat" ADD CONSTRAINT "WaChat_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WaInbound" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "chatId" TEXT NOT NULL,
    "waMessageId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderName" TEXT NOT NULL DEFAULT '',
    "isStaff" BOOLEAN NOT NULL DEFAULT false,
    "text" TEXT NOT NULL DEFAULT '',
    "at" TIMESTAMP(3) NOT NULL,
    "quotedWaId" TEXT,
    "mediaKey" TEXT,
    "mediaName" TEXT,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "ticketId" TEXT,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaInbound_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WaInbound_companyId_waMessageId_key" ON "WaInbound"("companyId", "waMessageId");
CREATE INDEX "WaInbound_companyId_state_idx" ON "WaInbound"("companyId", "state");
CREATE INDEX "WaInbound_chatId_at_idx" ON "WaInbound"("chatId", "at");
ALTER TABLE "WaInbound" ADD CONSTRAINT "WaInbound_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaInbound" ADD CONSTRAINT "WaInbound_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "WaChat"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WaInbound" ADD CONSTRAINT "WaInbound_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE SET NULL ON UPDATE CASCADE;
