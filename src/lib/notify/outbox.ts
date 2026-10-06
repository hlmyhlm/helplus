import nodemailer from "nodemailer";
import { prisma } from "@/lib/prisma";
import { getSettings } from "@/lib/settings";
import type { EmailKind } from "./templates";

export const MAX_ATTEMPTS = 5;
const BATCH = 50;

export type Sender = (msg: { to: string; subject: string; text: string }) => Promise<void>;

export async function queueEmail(e: { to: string; subject: string; body: string; kind: EmailKind; ticketId?: string | null }) {
  await prisma.emailOutbox.create({
    data: { to: e.to, subject: e.subject, body: e.body, kind: e.kind, ticketId: e.ticketId ?? null },
  });
}

export function nextAttemptAt(attempts: number, now: Date): Date {
  return new Date(now.getTime() + 2 ** attempts * 60_000);
}

async function smtpSender(): Promise<Sender> {
  const s = await getSettings();
  if (!s.smtpHost) {
    return async () => {
      throw new Error("Email isn't set up in Settings");
    };
  }
  const transport = nodemailer.createTransport({
    host: s.smtpHost,
    port: s.smtpPort,
    secure: s.smtpPort === 465,
    auth: s.smtpUser ? { user: s.smtpUser, pass: s.smtpPass } : undefined,
  });
  const from = s.smtpFrom || s.smtpUser;
  return async ({ to, subject, text }) => {
    await transport.sendMail({ from, to, subject, text });
  };
}

export async function drainOutbox(now = new Date(), send?: Sender): Promise<{ sent: number; failed: number }> {
  const rows = await prisma.emailOutbox.findMany({
    where: { status: "pending", nextAttemptAt: { lte: now } },
    orderBy: { createdAt: "asc" },
    take: BATCH,
  });
  if (!rows.length) return { sent: 0, failed: 0 };
  const sender = send ?? (await smtpSender());
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    try {
      await sender({ to: row.to, subject: row.subject, text: row.body });
      await prisma.emailOutbox.update({ where: { id: row.id }, data: { status: "sent", sentAt: now, lastError: "" } });
      sent++;
    } catch (error) {
      const attempts = row.attempts + 1;
      const gaveUp = attempts >= MAX_ATTEMPTS;
      if (gaveUp) failed++;
      await prisma.emailOutbox.update({
        where: { id: row.id },
        data: {
          status: gaveUp ? "failed" : "pending",
          attempts,
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 500),
          nextAttemptAt: nextAttemptAt(attempts, now),
        },
      });
    }
  }
  return { sent, failed };
}
