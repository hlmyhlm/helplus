import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { CrossCompanyLinkError } from "@/lib/tenant/links";

const A = "it-3b-a";
const B = "it-3b-b";
let projA: string;
let projB: string;

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "A", slug: A },
      { id: B, name: "B", slug: B },
    ],
  });
  projA = (await runWithCompany(A, () => prisma.project.create({ data: { name: "General", isDefault: true } }))).id;
  projB = (await runWithCompany(B, () => prisma.project.create({ data: { name: "General", isDefault: true } }))).id;
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("imports schema", () => {
  it("ticket import keys are unique per company", async () => {
    await runWithCompany(A, () =>
      prisma.ticket.create({ data: { number: 1, title: "t", description: "", projectId: projA, importKey: "csv:1" } })
    );
    await expect(
      runWithCompany(A, () =>
        prisma.ticket.create({ data: { number: 2, title: "t", description: "", projectId: projA, importKey: "csv:1" } })
      )
    ).rejects.toMatchObject({ code: "P2002" });
    const b = await runWithCompany(B, () =>
      prisma.ticket.create({ data: { number: 1, title: "t", description: "", projectId: projB, importKey: "csv:1" } })
    );
    expect(b.importKey).toBe("csv:1");
  });

  it("message import keys are unique per company", async () => {
    const convA = await runWithCompany(A, () => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    const convB = await runWithCompany(B, () => prisma.conversation.create({ data: { channel: "whatsapp" } }));
    await runWithCompany(A, () =>
      prisma.message.create({ data: { conversationId: convA.id, role: "user", content: "hi", importKey: "wa:x" } })
    );
    await expect(
      runWithCompany(A, () =>
        prisma.message.create({ data: { conversationId: convA.id, role: "user", content: "hi", importKey: "wa:x" } })
      )
    ).rejects.toMatchObject({ code: "P2002" });
    const m = await runWithCompany(B, () =>
      prisma.message.create({ data: { conversationId: convB.id, role: "user", content: "hi", importKey: "wa:x" } })
    );
    expect(m.importKey).toBe("wa:x");
  });

  it("library drafts stay out of active entries", async () => {
    const entries = await runWithCompany(A, async () => {
      const cat = await prisma.category.create({ data: { name: "Imported" } });
      const t = await prisma.ticket.create({ data: { number: 3, title: "t", description: "", projectId: projA } });
      const old = await prisma.knowledgeEntry.create({ data: { categoryId: cat.id, title: "old", content: "c" } });
      expect(old.status).toBe("approved");
      await prisma.knowledgeEntry.create({
        data: {
          categoryId: cat.id,
          title: "draft",
          content: "c",
          status: "draft",
          isActive: false,
          projectId: projA,
          sourceTicketId: t.id,
        },
      });
      return prisma.knowledgeEntry.findMany({ where: { isActive: true } });
    });
    expect(entries.map((e) => e.title)).toEqual(["old"]);
  });

  it("an import job can't use another company's project", async () => {
    await expect(
      runWithCompany(B, () => prisma.importJob.create({ data: { projectId: projA, kind: "csv" } }))
    ).rejects.toThrow(CrossCompanyLinkError);
    const job = await runWithCompany(A, () => prisma.importJob.create({ data: { projectId: projA, kind: "csv" } }));
    expect(job.status).toBe("uploaded");
  });
});
