-- projects
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Project_companyId_name_key" ON "Project"("companyId", "name");
CREATE INDEX "Project_companyId_idx" ON "Project"("companyId");
ALTER TABLE "Project" ADD CONSTRAINT "Project_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "ProjectAccess" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "projectId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProjectAccess_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "ProjectAccess_projectId_adminId_key" ON "ProjectAccess"("projectId", "adminId");
CREATE INDEX "ProjectAccess_companyId_idx" ON "ProjectAccess"("companyId");
CREATE INDEX "ProjectAccess_adminId_idx" ON "ProjectAccess"("adminId");
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ProjectAccess" ADD CONSTRAINT "ProjectAccess_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "Admin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "TicketCounter" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL DEFAULT '',
    "next" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "TicketCounter_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TicketCounter_companyId_key" ON "TicketCounter"("companyId");
ALTER TABLE "TicketCounter" ADD CONSTRAINT "TicketCounter_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- a default project per company
INSERT INTO "Project" ("id", "companyId", "name", "isDefault", "updatedAt")
SELECT gen_random_uuid()::text, c."id", 'General', true, CURRENT_TIMESTAMP FROM "Company" c;

-- existing staff and viewers can see the default project
INSERT INTO "ProjectAccess" ("id", "companyId", "projectId", "adminId")
SELECT gen_random_uuid()::text, a."companyId", p."id", a."id"
FROM "Admin" a JOIN "Project" p ON p."companyId" = a."companyId" AND p."isDefault"
WHERE a."role" IN ('staff', 'viewer');

-- people and settings
ALTER TABLE "Customer" ADD COLUMN "projectId" TEXT;
CREATE INDEX "Customer_projectId_idx" ON "Customer"("projectId");
ALTER TABLE "Customer" ADD CONSTRAINT "Customer_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Settings" ADD COLUMN "projectLabel" TEXT NOT NULL DEFAULT 'Clients';

-- ticket columns
ALTER TABLE "Ticket"
  ADD COLUMN "number" INTEGER,
  ADD COLUMN "projectId" TEXT,
  ADD COLUMN "assigneeId" TEXT,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'quick_add',
  ADD COLUMN "category" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "firstReplyAt" TIMESTAMP(3),
  ADD COLUMN "answeredAt" TIMESTAMP(3),
  ADD COLUMN "closedAt" TIMESTAMP(3),
  ADD COLUMN "reopenCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "aiMatch" INTEGER;

-- every conversation without a ticket gets one, so nothing disappears from the inbox
INSERT INTO "Ticket" ("id", "companyId", "conversationId", "title", "description", "status", "priority", "source", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, cv."companyId", cv."id",
  COALESCE(
    NULLIF(LEFT((SELECT m."content" FROM "Message" m WHERE m."conversationId" = cv."id" AND m."role" = 'customer' ORDER BY m."createdAt" LIMIT 1), 80), ''),
    'Conversation with ' || cv."customerName"),
  '',
  CASE WHEN cv."status" IN ('resolved', 'closed') THEN 'closed' ELSE 'new' END,
  'medium', cv."channel", cv."createdAt", CURRENT_TIMESTAMP
FROM "Conversation" cv
WHERE NOT EXISTS (SELECT 1 FROM "Ticket" t WHERE t."conversationId" = cv."id");

-- old statuses to the new steps
UPDATE "Ticket" SET "status" = CASE "status"
  WHEN 'open' THEN 'new'
  WHEN 'in_progress' THEN 'working'
  WHEN 'resolved' THEN 'closed'
  ELSE "status" END;
UPDATE "Ticket" SET "closedAt" = "updatedAt" WHERE "status" = 'closed' AND "closedAt" IS NULL;
UPDATE "Ticket" t SET "source" = cv."channel"
FROM "Conversation" cv WHERE t."conversationId" = cv."id" AND t."source" = 'quick_add';

-- default project and per-company numbers
UPDATE "Ticket" t SET "projectId" = p."id" FROM "Project" p WHERE p."companyId" = t."companyId" AND p."isDefault";
UPDATE "Ticket" t SET "number" = n.rn
FROM (SELECT "id", ROW_NUMBER() OVER (PARTITION BY "companyId" ORDER BY "createdAt", "id") AS rn FROM "Ticket") n
WHERE n."id" = t."id";
INSERT INTO "TicketCounter" ("id", "companyId", "next")
SELECT gen_random_uuid()::text, c."id", COALESCE((SELECT MAX(t."number") FROM "Ticket" t WHERE t."companyId" = c."id"), 0) + 1
FROM "Company" c;

ALTER TABLE "Ticket" ALTER COLUMN "number" SET NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "projectId" SET NOT NULL;
ALTER TABLE "Ticket" ALTER COLUMN "status" SET DEFAULT 'new';
CREATE UNIQUE INDEX "Ticket_companyId_number_key" ON "Ticket"("companyId", "number");
CREATE INDEX "Ticket_projectId_idx" ON "Ticket"("projectId");
CREATE INDEX "Ticket_assigneeId_idx" ON "Ticket"("assigneeId");
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "Admin"("id") ON DELETE SET NULL ON UPDATE CASCADE;
