import { prisma } from "@/lib/prisma";
import { currentCompanyId } from "@/lib/tenant/context";

// counter row per company; the update is a single atomic increment.
// the first ever call can race on the insert, so retry once on a unique clash.
export async function nextTicketNumber(): Promise<number> {
  for (let attempt = 0; ; attempt++) {
    try {
      const counter = await prisma.ticketCounter.upsert({
        where: { companyId: currentCompanyId() },
        update: { next: { increment: 1 } },
        create: { next: 2 },
      });
      return counter.next - 1;
    } catch (error) {
      if (attempt === 0 && (error as { code?: string }).code === "P2002") continue;
      throw error;
    }
  }
}
