// foreign keys between company tables. every write checks these point at rows of the same company.
// tenant-links.test.ts fails if this drifts from schema.prisma.
export const LINKS: Record<string, Record<string, string>> = {
  KnowledgeEntry: { categoryId: "Category" },
  TeamMember: { departmentId: "Department" },
  Conversation: { customerId: "Customer" },
  Message: { conversationId: "Conversation" },
  Ticket: {
    conversationId: "Conversation",
    departmentId: "Department",
    assignedToId: "TeamMember",
    projectId: "Project",
    assigneeId: "Admin",
    slaRuleId: "SLARule",
  },
  ConversationTag: { conversationId: "Conversation", tagId: "Tag" },
  WebhookDelivery: { webhookId: "Webhook" },
  CustomerNote: { customerId: "Customer" },
  InternalNote: { conversationId: "Conversation" },
  ProjectAccess: { projectId: "Project", adminId: "Admin" },
  Customer: { projectId: "Project" },
  SLARule: { projectId: "Project" },
  EmailOutbox: { ticketId: "Ticket" },
};

// relation fields between company tables (not `company`), model -> field -> target model.
// nested writes through these skip the LINKS check, so the scoped client refuses them.
export const RELATIONS: Record<string, Record<string, string>> = {
  Category: { entries: "KnowledgeEntry" },
  KnowledgeEntry: { category: "Category" },
  Department: { members: "TeamMember", tickets: "Ticket" },
  TeamMember: { department: "Department", tickets: "Ticket" },
  Conversation: {
    customer: "Customer",
    messages: "Message",
    tickets: "Ticket",
    tags: "ConversationTag",
    notes: "InternalNote",
  },
  Message: { conversation: "Conversation" },
  Ticket: {
    conversation: "Conversation",
    department: "Department",
    assignedTo: "TeamMember",
    project: "Project",
    assignee: "Admin",
    slaRule: "SLARule",
    emails: "EmailOutbox",
  },
  Tag: { conversations: "ConversationTag" },
  ConversationTag: { conversation: "Conversation", tag: "Tag" },
  Webhook: { deliveries: "WebhookDelivery" },
  WebhookDelivery: { webhook: "Webhook" },
  Customer: { notes: "CustomerNote", conversations: "Conversation", project: "Project" },
  CustomerNote: { customer: "Customer" },
  InternalNote: { conversation: "Conversation" },
  Admin: { assignedTickets: "Ticket", projectAccess: "ProjectAccess" },
  Project: { tickets: "Ticket", customers: "Customer", access: "ProjectAccess", slaRules: "SLARule" },
  ProjectAccess: { project: "Project", admin: "Admin" },
  SLARule: { project: "Project", tickets: "Ticket" },
  EmailOutbox: { ticket: "Ticket" },
};

// the only nested creates allowed. each nested row gets the current company stamped on it.
export const NESTED_CREATE_OK = new Set(["Customer.notes"]);

export class CrossCompanyLinkError extends Error {
  constructor(model: string, field: string, reason = "points at a row of another company") {
    super(`${model}.${field} ${reason}`);
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

type Row = Record<string, unknown>;
export type NestedRows = { model: string; rows: Row[] };

function asRows(v: unknown): Row[] {
  const list = Array.isArray(v) ? v : [v];
  return list.filter((r): r is Row => !!r && typeof r === "object");
}

function guardRow(model: string, row: Row, companyId: string, nested: NestedRows[]): Row {
  const relations = RELATIONS[model];
  if (!relations) return row;
  const out: Row = { ...row };
  for (const [field, target] of Object.entries(relations)) {
    const rel = out[field];
    if (rel === undefined || rel === null) continue;
    if (typeof rel !== "object") throw new CrossCompanyLinkError(model, field, "nested write isn't allowed, set the id instead");
    const next: Row = {};
    for (const [op, v] of Object.entries(rel as Row)) {
      if ((op !== "create" && op !== "createMany") || !NESTED_CREATE_OK.has(`${model}.${field}`)) {
        throw new CrossCompanyLinkError(model, field, `nested ${op} isn't allowed, set the id instead`);
      }
      const source = op === "create" ? v : (v as Row | undefined)?.data;
      const rows = asRows(source).map((r) => ({ ...guardRow(target, r, companyId, nested), companyId }));
      nested.push({ model: target, rows });
      if (op === "create") next.create = Array.isArray(v) ? rows : rows[0];
      else next.createMany = { ...(v as Row), data: rows };
    }
    out[field] = next;
  }
  return out;
}

// checks nested relation writes and stamps the company on allowed nested creates.
// returns new args plus the nested rows, so their own foreign keys get checked too.
export function guardNestedWrites(
  model: string,
  operation: string,
  args: Row,
  companyId: string
): { args: Row; nested: NestedRows[] } {
  const nested: NestedRows[] = [];
  const keys = operation === "upsert" ? ["create", "update"] : ["data"];
  const out: Row = { ...args };
  for (const key of keys) {
    const payload = out[key];
    if (!payload || typeof payload !== "object") continue;
    out[key] = Array.isArray(payload)
      ? payload.map((r) => (r && typeof r === "object" ? guardRow(model, r as Row, companyId, nested) : r))
      : guardRow(model, payload as Row, companyId, nested);
  }
  return { args: out, nested };
}
