import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany, currentCompanyId } from "@/lib/tenant/context";
import { getSettings, saveSettings } from "@/lib/settings";

const A = "it-settings-a";
const B = "it-settings-b";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.company.createMany({
    data: [
      { id: A, name: "A", slug: A },
      { id: B, name: "B", slug: B },
    ],
  });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: { in: [A, B] } } });
  await systemPrisma.$disconnect();
});

describe("settings per company", () => {
  it("gives each company its own row", async () => {
    await runWithCompany(A, () => saveSettings({ businessName: "Alpha", aiApiKey: "sk-alpha" }));
    await runWithCompany(B, () => saveSettings({ businessName: "Beta" }));
    const a = await runWithCompany(A, getSettings);
    const b = await runWithCompany(B, getSettings);
    expect(a.businessName).toBe("Alpha");
    expect(a.aiApiKey).toBe("sk-alpha");
    expect(b.businessName).toBe("Beta");
    expect(b.aiApiKey).toBe("");
  });

  it("stores secrets encrypted", async () => {
    const raw = await systemPrisma.settings.findUnique({ where: { companyId: A } });
    expect(raw?.aiApiKey.startsWith("enc:v1:")).toBe(true);
  });

  it("creates a row on first read for a new company", async () => {
    const s = await runWithCompany(B, getSettings);
    expect(s.companyId).toBe(B);
  });
});

describe("business hours per company", () => {
  it("lets two companies save their own hours", async () => {
    const save = (tz: string) =>
      prisma.businessHours.upsert({
        where: { companyId: currentCompanyId() },
        update: { timezone: tz },
        create: { timezone: tz },
      });
    await runWithCompany(A, () => save("Asia/Kuala_Lumpur"));
    await runWithCompany(B, () => save("UTC"));
    const a = await runWithCompany(A, () => prisma.businessHours.findUnique({ where: { companyId: A } }));
    const b = await runWithCompany(B, () => prisma.businessHours.findUnique({ where: { companyId: B } }));
    expect(a?.timezone).toBe("Asia/Kuala_Lumpur");
    expect(b?.timezone).toBe("UTC");
  });
});
