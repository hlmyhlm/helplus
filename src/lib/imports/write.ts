import { prisma } from "@/lib/prisma";
import { maskIC, IC_PLACEHOLDER } from "@/lib/privacy/ic-mask";
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
const PHONE_CHARS = /^[+\d\s()-]+$/;

export async function importedCategoryId(): Promise<string> {
  const found = await prisma.category.findFirst({ where: { name: IMPORTED }, select: { id: true } });
  if (found) return found.id;
  const created = await prisma.category.create({ data: { name: IMPORTED, description: "Answers brought in from imports" } });
  return created.id;
}

// malaysian local numbers drop the leading 0 for the 60 country code
function phoneDigits(raw: string): string | null {
  if (!PHONE_CHARS.test(raw)) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("0")) digits = `60${digits.slice(1)}`;
  return digits.length >= 8 ? digits : null;
}

const isPlaceholderName = (name: string) => name === "Unknown" || name.includes(IC_PLACEHOLDER);

// a sender that looks like a number is matched by phone, anyone else by name
async function customerFor(projectId: string, client: { name: string; contact?: string }): Promise<string> {
  const raw = client.contact || client.name;
  // an IC can look like a phone number too, so only trust it as one when it isn't an IC
  const phone = maskIC(raw).count === 0 ? phoneDigits(raw) : null;
  const name = mask(client.name).slice(0, 200) || "Unknown";

  if (phone) {
    const existing = await prisma.customer.findFirst({ where: { phone }, select: { id: true, projectId: true } });
    if (existing) {
      if (!existing.projectId) await prisma.customer.update({ where: { id: existing.id }, data: { projectId } });
      return existing.id;
    }
    return (await prisma.customer.create({ data: { name, phone, projectId } })).id;
  }

  if (!isPlaceholderName(name)) {
    const existing = await prisma.customer.findFirst({ where: { name, projectId }, select: { id: true } });
    if (existing) return existing.id;
  }
  return (await prisma.customer.create({ data: { name, phone: "", projectId } })).id;
}

export async function writeImportedTicket(qa: ImportedQa): Promise<WriteResult> {
  if (await prisma.ticket.findFirst({ where: { importKey: qa.importKey }, select: { id: true } })) {
    return { created: false, images: 0, skippedImages: 0 };
  }

  // sort by time but keep each message's original position, so images can still point back by it
  const order = qa.messages.map((_, i) => i).sort((a, b) => qa.messages[a].at.getTime() - qa.messages[b].at.getTime());
  const msgs = order.map((i) => qa.messages[i]);
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
    if (!isP2002(error)) throw error;
    // the importKey race was real only if another ticket actually holds it; otherwise this
    // was a plain ticket-number collision, which must not be swallowed
    const already = await prisma.ticket.findFirst({ where: { importKey: qa.importKey }, select: { id: true } });
    await prisma.conversation.delete({ where: { id: conversation.id } });
    if (already) return { created: false, images: 0, skippedImages: 0 };
    throw error;
  }

  // keep index alignment with qa.messages (not the sorted order) so images land on the right one
  const savedByInput: ({ id: string } | null)[] = new Array(qa.messages.length).fill(null);
  for (let k = 0; k < msgs.length; k++) {
    const m = msgs[k];
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
      savedByInput[order[k]] = row;
    } catch (error) {
      // a re-imported overlap can hit a message we already saved, skip it and keep going
      if (!isP2002(error)) throw error;
    }
  }

  if (qa.closeNote) {
    await prisma.internalNote.create({ data: { conversationId: conversation.id, content: mask(qa.closeNote), authorName: "Help+" } });
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
      { ticketId: ticket.id, messageId: savedByInput[img.messageIndex]?.id ?? null, fileName: img.fileName, data: img.data },
      { process: false }
    );
    images++;
  }

  return { created: true, ticketId: ticket.id, draftId, images, skippedImages };
}
