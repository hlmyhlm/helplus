import { createHash } from "crypto";
import type { ChatMessage } from "./parse";

export const QUIET_GAP_MS = 4 * 3600_000;
export const AFTER_ANSWER_GAP_MS = 30 * 60_000;

export interface Issue {
  messages: ChatMessage[];
  client: string;
  answered: boolean;
  firstAt: Date;
  lastAt: Date;
  firstReplyAt: Date | null;
}

export function groupIssues(messages: ChatMessage[], isStaff: (sender: string) => boolean) {
  const issues: Issue[] = [];
  let announcements = 0;
  let current: Issue | null = null;

  for (const m of [...messages].sort((a, b) => a.at.getTime() - b.at.getTime())) {
    if (m.system || !m.sender) continue;
    const gap = current ? m.at.getTime() - current.lastAt.getTime() : Infinity;
    if (isStaff(m.sender)) {
      if (!current || gap >= QUIET_GAP_MS) {
        announcements++;
        current = null;
        continue;
      }
      current.messages.push(m);
      current.lastAt = m.at;
      if (!current.answered) {
        current.answered = true;
        current.firstReplyAt = m.at;
      }
      continue;
    }
    const startNew = !current || gap >= QUIET_GAP_MS || (current.answered && gap >= AFTER_ANSWER_GAP_MS);
    if (startNew) {
      current = { messages: [m], client: m.sender, answered: false, firstAt: m.at, lastAt: m.at, firstReplyAt: null };
      issues.push(current);
    } else {
      current!.messages.push(m);
      current!.lastAt = m.at;
    }
  }
  return { issues, announcements };
}

// minute precision so the same chat exported from different phones lines up
function minuteIso(d: Date): string {
  return new Date(Math.floor(d.getTime() / 60_000) * 60_000).toISOString();
}

export function messageKey(projectId: string, m: ChatMessage): string {
  const raw = [projectId, minuteIso(m.at), m.sender, m.text, m.attachment ?? ""].join("\u0001");
  return `wa:${createHash("sha256").update(raw).digest("hex")}`;
}

export function issueKey(projectId: string, issue: Issue): string {
  return messageKey(projectId, issue.messages[0]).replace(/^wa:/, "wa-issue:");
}
