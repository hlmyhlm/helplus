import { prisma } from "@/lib/prisma";
import { maskIC, IC_PLACEHOLDER } from "@/lib/privacy/ic-mask";
import { nextTicketNumber } from "@/lib/tickets/number";
import { titleFrom } from "@/lib/tickets/service";
import { addAttachment, maskedFileName } from "@/lib/attachments/service";
import { isAllowedImage } from "@/lib/privacy/ic-image";

export interface ImportedQa {
  importKey: string;
  projectId: string;
  source: "whatsapp_export" | "old_system";
  channel: "whatsapp" | "import";
  title?: string;
  category?: string;
  priority?: string;
  client: { name: string; contact?: string };
  messages: { role: "customer" | "agent"; text: string; at: Date; importKey?: string }[];
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

type QaMessage = ImportedQa["messages"][number];

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
  // anything IC-shaped is never kept as a phone
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

// sort by time but remember each message's original position, so images can point back by it
function sortByTime(messages: QaMessage[]): { order: number[]; msgs: QaMessage[] } {
  const order = messages.map((_, i) => i).sort((a, b) => messages[a].at.getTime() - messages[b].at.getTime());
  return { order, msgs: order.map((i) => messages[i]) };
}

function questionAndAnswers(msgs: QaMessage[]): { question: string; answers: string } {
  const question = msgs.filter((m) => m.role === "customer").map((m) => mask(m.text)).join("\n").trim();
  const answers = msgs.filter((m) => m.role === "agent").map((m) => mask(m.text)).join("\n").trim();
  return { question, answers };
}

// a crash mid-write can leave a ticket holding the importKey with little else saved; top it up
async function repairImportedTicket(qa: ImportedQa, ticketId: string): Promise<WriteResult> {
  const ticket = await prisma.ticket.findUniqueOrThrow({
    where: { id: ticketId },
    select: { id: true, conversationId: true, title: true },
  });
  const conversationId = ticket.conversationId;
  if (!conversationId) return { created: false, ticketId: ticket.id, images: 0, skippedImages: 0 };

  const existingCount = await prisma.message.count({ where: { conversationId } });
  // all messages there means done, so a note or draft staff deleted doesn't come back
  if (existingCount >= qa.messages.length) {
    return { created: false, ticketId: ticket.id, images: 0, skippedImages: 0 };
  }

  const { order, msgs } = sortByTime(qa.messages);
  const { question, answers } = questionAndAnswers(msgs);

  const savedByInput: ({ id: string } | null)[] = new Array(qa.messages.length).fill(null);
  for (let k = 0; k < msgs.length; k++) {
    const m = msgs[k];
    // csv messages have no key, so only add past what's already there
    if (!m.importKey && k < existingCount) continue;
    try {
      const row = await prisma.message.create({
        data: { conversationId, role: m.role, content: mask(m.text), createdAt: m.at, importKey: m.importKey ?? null },
      });
      savedByInput[order[k]] = row;
    } catch (error) {
      if (!isP2002(error)) throw error;
      // already saved, look it up so its image still points at it
      if (m.importKey) {
        savedByInput[order[k]] = await prisma.message.findFirst({
          where: { conversationId, importKey: m.importKey },
          select: { id: true },
        });
      }
    }
  }

  if (qa.closeNote) {
    const hasNote = await prisma.internalNote.count({ where: { conversationId } });
    if (!hasNote) {
      await prisma.internalNote.create({ data: { conversationId, content: mask(qa.closeNote), authorName: "Help+" } });
    }
  }

  let draftId: string | undefined;
  if (question && answers) {
    const existingDraft = await prisma.knowledgeEntry.findFirst({ where: { sourceTicketId: ticket.id }, select: { id: true } });
    if (existingDraft) {
      draftId = existingDraft.id;
    } else {
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
  }

  let images = 0;
  let skippedImages = 0;
  for (const img of qa.images ?? []) {
    if (!(await isAllowedImage(img.data))) {
      skippedImages++;
      continue;
    }
    const already = await prisma.attachment.findFirst({
      where: { ticketId: ticket.id, fileName: maskedFileName(img.fileName) },
      select: { id: true },
    });
    if (already) continue; // already attached from an earlier pass, not new and not skipped
    await addAttachment(
      { ticketId: ticket.id, messageId: savedByInput[img.messageIndex]?.id ?? null, fileName: img.fileName, data: img.data },
      { process: false }
    );
    images++;
  }

  return { created: false, ticketId: ticket.id, draftId, images, skippedImages };
}

export async function writeImportedTicket(qa: ImportedQa): Promise<WriteResult> {
  const existing = await prisma.ticket.findFirst({ where: { importKey: qa.importKey }, select: { id: true } });
  if (existing) return repairImportedTicket(qa, existing.id);

  const { order, msgs } = sortByTime(qa.messages);
  const { question, answers } = questionAndAnswers(msgs);
  const firstReply = msgs.find((m) => m.role === "agent")?.at ?? null;
  const first = msgs[0]?.at ?? new Date();
  const last = msgs.at(-1)?.at ?? first;

  const customerId = await customerFor(qa.projectId, qa.client);
  const conversation = await prisma.conversation.create({
    data: {
      channel: qa.channel,
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
        category: mask(qa.category ?? "").slice(0, 100),
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
    // only a lost importKey race is fine, a ticket number clash still throws
    const already = await prisma.ticket.findFirst({ where: { importKey: qa.importKey }, select: { id: true } });
    try {
      await prisma.conversation.delete({ where: { id: conversation.id } });
    } catch {
      // best-effort cleanup; the conflict below is the error that matters
    }
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
