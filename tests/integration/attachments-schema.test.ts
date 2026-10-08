import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";
import { createTicket } from "@/lib/tickets/service";

const A = "it-3a-schema-a";
const B = "it-3a-schema-b";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({ data: [{ id: A, name: "A", slug: A }, { id: B, name: "B", slug: B }] });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("attachments schema", () => {
  it("can't attach to another company's ticket", async () => {
    const t = await runWithCompany(A, () => createTicket({ text: "x" }));
    await expect(runWithCompany(B, () => prisma.attachment.create({ data: { ticketId: t.id } }))).rejects.toThrow(
      CrossCompanyLinkError
    );
  });

  it("goes away with its ticket and keeps 90 days by default", async () => {
    const t = await runWithCompany(A, () => createTicket({ text: "y" }));
    const a = await runWithCompany(A, () => prisma.attachment.create({ data: { ticketId: t.id } }));
    expect(a.status).toBe("pending");
    await runWithCompany(A, () => prisma.ticket.delete({ where: { id: t.id } }));
    expect(await runWithCompany(A, () => prisma.attachment.findUnique({ where: { id: a.id } }))).toBeNull();
    const s = await runWithCompany(A, () => prisma.settings.create({ data: {} }));
    expect(s.originalRetentionDays).toBe(90);
  });
});
