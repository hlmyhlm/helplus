import { describe, it, expect } from "vitest";
import { groupIssues, messageKey, issueKey } from "@/lib/imports/whatsapp/group";
import { parseChat, type ChatMessage } from "@/lib/imports/whatsapp/parse";

const t0 = Date.UTC(2026, 9, 12, 1, 0);
const msg = (min: number, sender: string, text = "x", system = false): ChatMessage => ({
  at: new Date(t0 + min * 60_000),
  sender,
  text,
  attachment: null,
  system,
});
const staff = (s: string) => s.startsWith("Support");

describe("groupIssues", () => {
  it("keeps a question and its replies together", () => {
    const { issues } = groupIssues([msg(0, "Aminah"), msg(1, "Aminah"), msg(20, "Support Ali"), msg(25, "Aminah", "thanks")], staff);
    expect(issues).toHaveLength(1);
    expect(issues[0].answered).toBe(true);
    expect(issues[0].firstReplyAt).toEqual(new Date(t0 + 20 * 60_000));
  });

  it("starts a new issue after an answer and a 30 minute gap", () => {
    const { issues } = groupIssues([msg(0, "Aminah"), msg(10, "Support Ali"), msg(50, "Aminah", "another thing")], staff);
    expect(issues).toHaveLength(2);
  });

  it("starts a new issue after 4 quiet hours even without an answer", () => {
    const { issues } = groupIssues([msg(0, "Ben"), msg(5 * 60, "Ben")], staff);
    expect(issues).toHaveLength(2);
    expect(issues.every((i) => !i.answered)).toBe(true);
  });

  it("lets different clients ask inside the same open issue window", () => {
    const { issues } = groupIssues([msg(0, "Aminah"), msg(3, "Ben"), msg(10, "Support Ali")], staff);
    expect(issues).toHaveLength(1);
    expect(issues[0].client).toBe("Aminah");
  });

  it("skips system lines and counts staff announcements", () => {
    const { issues, announcements } = groupIssues([msg(0, "", "added", true), msg(1, "Support Ali", "Server down tonight")], staff);
    expect(issues).toHaveLength(0);
    expect(announcements).toBe(1);
  });
});

describe("keys", () => {
  it("are stable and change with the content", () => {
    const a = msg(0, "Aminah", "hello");
    expect(messageKey("p1", a)).toBe(messageKey("p1", { ...a }));
    expect(messageKey("p1", a)).not.toBe(messageKey("p1", { ...a, text: "hello!" }));
    expect(messageKey("p1", a)).not.toBe(messageKey("p2", a));
    expect(messageKey("p1", a)).toMatch(/^wa:[0-9a-f]{64}$/);
  });

  it("ignore seconds so iphone and android exports of the same chat match", () => {
    const a = msg(0, "Aminah", "hello");
    const b = { ...a, at: new Date(a.at.getTime() + 37_000) };
    expect(messageKey("p1", a)).toBe(messageKey("p1", b));
  });

  it("issue key is the first message key", () => {
    const { issues } = groupIssues([msg(0, "Aminah", "q")], staff);
    expect(issueKey("p1", issues[0])).toBe(messageKey("p1", issues[0].messages[0]).replace(/^wa:/, "wa-issue:"));
  });
});

describe("late answers", () => {
  it("attaches a staff answer more than 4h after the question", () => {
    const { issues, announcements } = groupIssues([msg(0, "Aminah"), msg(5 * 60, "Support Ali")], staff);
    expect(issues).toHaveLength(1);
    expect(issues[0].answered).toBe(true);
    expect(announcements).toBe(0);
  });

  it("treats staff after 72h as an announcement", () => {
    const { issues, announcements } = groupIssues([msg(0, "Aminah"), msg(73 * 60, "Support Ali")], staff);
    expect(issues).toHaveLength(1);
    expect(issues[0].answered).toBe(false);
    expect(announcements).toBe(1);
  });

  it("still counts staff after an answered issue goes quiet", () => {
    const { announcements } = groupIssues([msg(0, "Aminah"), msg(10, "Support Ali"), msg(10 + 5 * 60, "Support Ali")], staff);
    expect(announcements).toBe(1);
  });
});

describe("re-import keys", () => {
  it("match android with and without media", () => {
    const withMedia = { ...msg(0, "Aminah", ""), attachment: "IMG-20261012-WA0001.jpg" };
    const noMedia = msg(0, "Aminah", "<Media omitted>");
    expect(messageKey("p1", withMedia)).toBe(messageKey("p1", noMedia));
  });

  it("match iphone and android media placeholders", () => {
    expect(messageKey("p1", msg(0, "Aminah", "\u200eimage omitted"))).toBe(messageKey("p1", msg(0, "Aminah", "<Media omitted>")));
  });

  it("ignore the invisible mark and outer spaces", () => {
    expect(messageKey("p1", msg(0, "Aminah", "\u200e hello "))).toBe(messageKey("p1", msg(0, "Aminah", "hello")));
  });
});

describe("album keys", () => {
  const keys = (text: string) => parseChat(text).messages.map((m) => messageKey("p1", m));
  const LRM = String.fromCharCode(0x200e);

  it("differ for each photo in an android album", () => {
    const k = keys([1, 2, 3].map((n) => `12/10/2026, 10:00 - Ali: IMG-${n}.jpg (file attached)`).join("\n"));
    expect(new Set(k).size).toBe(3);
  });

  it("differ for each photo in an iphone album", () => {
    const k = keys([1, 2].map((n) => `[12/10/2026, 10:00:0${n}] Ali: ${LRM}<attached: 0000000${n}-PHOTO.jpg>`).join("\n"));
    expect(new Set(k).size).toBe(2);
  });

  it("match between with-media and without-media exports", () => {
    const withMedia = keys([1, 2, 3].map((n) => `12/10/2026, 10:00 - Ali: IMG-${n}.jpg (file attached)`).join("\n"));
    const noMedia = keys([1, 2, 3].map(() => "12/10/2026, 10:00 - Ali: <Media omitted>").join("\n"));
    expect(noMedia).toEqual(withMedia);
  });

  it("keep the old key for a single message", () => {
    const a = msg(0, "Aminah", "hello");
    expect(messageKey("p1", { ...a, seq: 0 })).toBe(messageKey("p1", a));
  });
});
