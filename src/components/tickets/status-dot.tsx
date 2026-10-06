import { STATUS_LABELS, isTicketStatus } from "@/lib/tickets/status";

const TONES: Record<string, string> = {
  new: "#3B82F6",
  ai_suggested: "#7A5AF8",
  answered: "#EAAA08",
  reopened: "#D92D20",
  working: "#F79009",
  closed: "#12B76A",
};

const SOURCES: Record<string, string> = {
  whatsapp: "WhatsApp",
  whatsapp_group: "WhatsApp group",
  staff_whatsapp: "Staff WhatsApp",
  web_form: "Web form",
  email: "Email",
  sms: "SMS",
  phone: "Phone",
  telegram: "Telegram",
  old_system: "Old system",
  quick_add: "Quick add",
  ai: "AI",
  api: "API",
};

export function statusTone(status: string): string {
  return TONES[status] ?? "#98A2B3";
}

export function sourceLabel(source: string): string {
  if (SOURCES[source]) return SOURCES[source];
  const words = source.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export function StatusDot({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-helplus-text whitespace-nowrap">
      <span className="h-[7px] w-[7px] rounded-full" style={{ background: statusTone(status) }} />
      {isTicketStatus(status) ? STATUS_LABELS[status] : status}
    </span>
  );
}
