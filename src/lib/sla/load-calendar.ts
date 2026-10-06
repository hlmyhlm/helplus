import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";
import { ALWAYS_OPEN, parseHours, type BusinessCalendar } from "./calendar";

// holidays only count while business hours are on
export async function loadCalendar(): Promise<BusinessCalendar> {
  const [hours, holidays] = await Promise.all([
    prisma.businessHours.findUnique({ where: { companyId: currentCompanyId() } }),
    prisma.holiday.findMany({ select: { date: true } }),
  ]);
  if (!hours?.enabled) return ALWAYS_OPEN;
  const week = [hours.sunday, hours.monday, hours.tuesday, hours.wednesday, hours.thursday, hours.friday, hours.saturday].map(
    parseHours
  );
  if (week.every((w) => !w)) return ALWAYS_OPEN;
  return { enabled: true, timezone: hours.timezone, week, holidays: new Set(holidays.map((h) => h.date)) };
}
