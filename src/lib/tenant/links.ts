// foreign keys between company tables. every write checks these point at rows of the same company.
// tenant-links.test.ts fails if this drifts from schema.prisma.
export const LINKS: Record<string, Record<string, string>> = {
  KnowledgeEntry: { categoryId: "Category" },
  TeamMember: { departmentId: "Department" },
  Conversation: { customerId: "Customer" },
  Message: { conversationId: "Conversation" },
  Ticket: { conversationId: "Conversation", departmentId: "Department", assignedToId: "TeamMember" },
  ConversationTag: { conversationId: "Conversation", tagId: "Tag" },
  WebhookDelivery: { webhookId: "Webhook" },
  CustomerNote: { customerId: "Customer" },
  InternalNote: { conversationId: "Conversation" },
};

export class CrossCompanyLinkError extends Error {
  constructor(model: string, field: string) {
    super(`${model}.${field} points at a row of another company`);
    this.name = "CrossCompanyLinkError";
  }
}

function value(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (v && typeof v === "object" && "set" in v && typeof (v as { set: unknown }).set === "string") {
    return (v as { set: string }).set;
  }
  return null;
}

export function linkedIds(model: string, data: unknown): { field: string; target: string; id: string }[] {
  const fields = LINKS[model];
  if (!fields || !data) return [];
  const rows = Array.isArray(data) ? data : [data];
  const out: { field: string; target: string; id: string }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    for (const [field, target] of Object.entries(fields)) {
      const id = value((row as Record<string, unknown>)[field]);
      if (!id || seen.has(`${field}:${id}`)) continue;
      seen.add(`${field}:${id}`);
      out.push({ field, target, id });
    }
  }
  return out;
}
