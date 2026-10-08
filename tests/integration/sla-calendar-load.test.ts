import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { loadCalendar } from "@/lib/sla/load-calendar";

const A = "it-2b-cal";

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "A", slug: A } });
});

afterAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
});

describe("loadCalendar", () => {
  it("is always open until business hours are on", async () => {
    const cal = await runWithCompany(A, loadCalendar);
    expect(cal.enabled).toBe(false);
  });

  it("reads the week and holidays", async () => {
    const cal = await runWithCompany(A, async () => {
      await prisma.businessHours.create({ data: { enabled: true, timezone: "Asia/Kuala_Lumpur" } });
      await prisma.holiday.create({ data: { date: "2026-12-25" } });
      return loadCalendar();
    });
    expect(cal.enabled).toBe(true);
    expect(cal.week[1]).toEqual([540, 1080]);
    expect(cal.week[0]).toBeNull();
    expect(cal.holidays.has("2026-12-25")).toBe(true);
  });
});
