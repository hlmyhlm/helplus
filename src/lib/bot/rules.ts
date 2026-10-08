export const QUIET_MS = 2 * 60_000;
export const FOLLOW_UP_MS = 4 * 3600_000;

export function senderDigits(waId: string): string {
  return waId.split("@")[0].replace(/\D/g, "");
}

// local 0 numbers are malaysian
export function phoneDigits(phone: string): string {
  const d = phone.replace(/\D/g, "");
  return d.startsWith("0") ? `6${d}` : d;
}

export function isStaffSender(
  s: { senderId: string; senderName: string },
  staff: { phones: Set<string>; names: Set<string>; botPhone: string }
): boolean {
  const digits = senderDigits(s.senderId);
  if (digits && digits === staff.botPhone) return false;
  return (digits !== "" && staff.phones.has(digits)) || staff.names.has(s.senderName);
}

export interface PendingMsg {
  id: string;
  senderId: string;
  isStaff: boolean;
  at: Date;
  quotedWaId: string | null;
}

export type Step = { kind: "client"; senderId: string; ids: string[] } | { kind: "staff"; id: string };

export function plan(pending: PendingMsg[], now: Date): Step[] {
  const sorted = [...pending].sort((a, b) => a.at.getTime() - b.at.getTime());
  const lastStaff = [...sorted].reverse().find((m) => m.isStaff)?.at.getTime() ?? -Infinity;
  const steps: Step[] = [];
  const batches = new Map<string, { kind: "client"; senderId: string; ids: string[] }>();
  const lastAt = new Map<string, number>();
  for (const m of sorted) if (!m.isStaff) lastAt.set(m.senderId, m.at.getTime());

  for (const m of sorted) {
    if (m.isStaff) {
      steps.push({ kind: "staff", id: m.id });
      // later client messages start a new batch after this reply
      batches.clear();
      continue;
    }
    // a staff reply after it means the question can't wait any longer
    const ready = m.at.getTime() < lastStaff || now.getTime() - lastAt.get(m.senderId)! >= QUIET_MS;
    if (!ready) continue;
    let b = batches.get(m.senderId);
    if (!b) {
      b = { kind: "client", senderId: m.senderId, ids: [] };
      batches.set(m.senderId, b);
      steps.push(b);
    }
    b.ids.push(m.id);
  }
  return steps;
}

export interface OpenTicketLite {
  id: string;
  lastActivityAt: Date;
}

export function placeUnquoted(open: OpenTicketLite[], at: Date): { ticketId: string } | "pick" | "ignore" {
  const recent = open.filter((t) => at.getTime() - t.lastActivityAt.getTime() < FOLLOW_UP_MS);
  if (recent.length === 1) return { ticketId: recent[0].id };
  return recent.length ? "pick" : "ignore";
}

// whatsapp images we keep; heic, tiff and svg only get a note
const STORED_IMAGES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

export function isStoredImage(mime: string): boolean {
  return STORED_IMAGES.has(mime.split(";")[0].trim().toLowerCase());
}
