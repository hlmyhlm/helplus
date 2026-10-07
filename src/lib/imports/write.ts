import { prisma } from "@/lib/prisma";
import { maskIC } from "@/lib/privacy/ic-mask";
import { nextTicketNumber } from "@/lib/tickets/number";
import { titleFrom } from "@/lib/tickets/service";
import { addAttachment } from "@/lib/attachments/service";
import { isAllowedImage } from "@/lib/privacy/ic-image";

export interface ImportedQa {
  importKey: string;
  projectId: string;
  source: "whatsapp_export" | "old_system";
  title?: string;
  category?: string;
  priority?: string;
  client: { name: string; contact?: string };
  messages: { role: "customer" | "agent"; text: string; at: Date; importKey?: string; author?: string }[];
  status: "closed" | "new";
  closeNote?: string;
  closedAt?: Date | null;
  images?: { fileName: string; data: Buffer; messageIndex: number }[];
}

export interface WriteResult {
  created: boolean;
  ticketId?: string;
  draftId?: string;
  images: number;
  skippedImages: number;
}

const mask = (s: string) => maskIC(s).text;
const IMPORTED = "Imported";
const isP2002 = (error: unknown) => (error as { code?: string })?.code === "P2002";

export async function importedCategoryId(): Promise<string> {
  const found = await prisma.category.findFirst({ where: { name: IMPORTED }, select: { id: true } });
  if (found) return found.id;
  const created = await prisma.category.create({ data: { name: IMPORTED, description: "Answers brought in from imports" } });
  return created.id;
}

// a sender that looks like a number is matched by phone, anyone else by name
async function customerFor(projectId: string, client: { name: string; contact?: string }): Promise<string> {
  const raw = client.contact || client.name;
  const digits = raw.replace(/\D/g, "");
  const isPhone = digits.length >= 8 && /^[+\d\s()-]+$/.test(raw);
  const name = mask(client.name).slice(0, 200) || "Unknown";
  const existing = await prisma.customer.findFirst({
    where: isPhone ? { phone: digits } : { name },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await prisma.customer.create({
    data: { name, phone: isPhone ? digits : "", projectId },
  });
  return created.id;
}

export async function writeImportedTicket(qa: ImportedQa): Promise<WriteResult> {
  if (await prisma.ticket.findFirst({ where: { importKey: qa.importKey }, select: { id: true } })) {
    return { created: false, images: 0, skippedImages: 0 };
  }

  const msgs = [...qa.messages].sort((a, b) => a.at.getTime() - b.at.getTime());
  const question = msgs.filter((m) => m.role === "customer").map((m) => mask(m.text)).join("\n").trim();
  const answers = msgs.filter((m) => m.role === "agent").map((m) => mask(m.text)).join("\n").trim();
  const firstReply = msgs.find((m) => m.role === "agent")?.at ?? null;
  const first = msgs[0]?.at ?? new Date();
  const last = msgs.at(-1)?.at ?? first;

  const customerId = await customerFor(qa.projectId, qa.client);
  const conversation = await prisma.conversation.create({
    data: {
      channel: "whatsapp",
      customerName: mask(qa.client.name).slice(0, 200) || "Unknown",
      customerContact: mask(qa.client.contact ?? "").slice(0, 200),
      customerId,
      status: qa.status === "closed" ? "closed" : "active",
      createdAt: first,
    },
  });

  // keep index alignment with msgs so images can point back by position, even past a skipped duplicate
  const saved: ({ id: string } | null)[] = [];
  for (const m of msgs) {
    try {
      const row = await prisma.message.create({
        data: {
          conversationId: conversation.id,
          role: m.role,
          content: mask(m.text),
          createdAt: m.at,
          importKey: m.importKey ?? null,
        },
      });
      saved.push(row);
    } catch (error) {
      // a re-imported overlap can hit a message we already saved, skip it and keep going
      if (!isP2002(error)) throw error;
      saved.push(null);
    }
  }

  const closed = qa.status === "closed";
  let ticket;
  try {
    ticket = await prisma.ticket.create({
      data: {
        number: await nextTicketNumber(),
        title: mask(qa.title?.trim() || titleFrom(question || answers)).slice(0, 200),
        description: question || answers,
        source: qa.source,
        projectId: qa.projectId,
        priority: qa.priority ?? "medium",
        category: qa.category ?? "",
        status: closed ? "closed" : "new",
        conversationId: conversation.id,
        importKey: qa.importKey,
        createdAt: first,
        firstReplyAt: firstReply,
        answeredAt: firstReply,
        closedAt: closed ? (qa.closedAt ?? last) : null,
      },
    });
  } catch (error) {
    // two imports raced past the earlier check, the other one won
    if (!isP2002(error)) throw error;
    await prisma.conversation.delete({ where: { id: conversation.id } });
    return { created: false, images: 0, skippedImages: 0 };
  }

  if (qa.closeNote) {
    await prisma.internalNote.create({ data: { conversationId: conversation.id, content: qa.closeNote, authorName: "Help+" } });
  }

  let draftId: string | undefined;
  if (question && answers) {
    const draft = await prisma.knowledgeEntry.create({
      data: {
        categoryId: await importedCategoryId(),
        title: ticket.title,
        content: `Q: ${question}\n\nA: ${answers}`,
        isActive: false,
        status: "draft",
        projectId: qa.projectId,
        sourceTicketId: ticket.id,
      },
    });
    draftId = draft.id;
  }

  let images = 0;
  let skippedImages = 0;
  for (const img of qa.images ?? []) {
    if (!(await isAllowedImage(img.data))) {
      skippedImages++;
      continue;
    }
    await addAttachment(
      { ticketId: ticket.id, messageId: saved[img.messageIndex]?.id ?? null, fileName: img.fileName, data: img.data },
      { process: false }
    );
    images++;
  }

  return { created: true, ticketId: ticket.id, draftId, images, skippedImages };
}
