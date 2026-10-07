import { prisma } from "@/lib/prisma";
import { companyName } from "./notify";
import { queueEmail } from "./outbox";

export async function emailBotDown(): Promise<number> {
  const rows = await prisma.admin.findMany({
    where: { role: { in: ["admin", "owner"] }, email: { not: "" } },
    select: { email: true },
  });
  const to = [...new Set(rows.map((r) => r.email.trim().toLowerCase()).filter(Boolean))];
  if (!to.length) return 0;
  const app = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const body = [
    `The WhatsApp bot for ${await companyName()} was disconnected. Open Sources > Channels and connect it again.`,
    `${app}/channels`,
  ].join("\n");
  for (const address of to) {
    await queueEmail({ to: address, subject: "WhatsApp bot disconnected", body, kind: "bot_disconnected" });
  }
  return to.length;
}
