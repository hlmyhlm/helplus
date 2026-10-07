import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";
import { parseChat, detectDateOrder } from "@/lib/imports/whatsapp/parse";

const fixture = (name: string) => readFileSync(path.join(__dirname, "../fixtures/wa", name), "utf8");
const utc = (s: string) => new Date(s);

describe("detectDateOrder", () => {
  it("reads day first when a first number is over 12", () => {
    expect(detectDateOrder(fixture("android-en.txt"))).toBe("dmy");
  });
  it("reads month first when a second number is over 12", () => {
    expect(detectDateOrder(fixture("us-order.txt"))).toBe("mdy");
  });
  it("defaults to day first", () => {
    expect(detectDateOrder("01/02/2026, 10:00 - A: hi")).toBe("dmy");
  });
});

describe("parseChat android", () => {
  const { messages } = parseChat(fixture("android-en.txt"));

  it("marks the encryption notice and added lines as system", () => {
    expect(messages[0].system).toBe(true);
    expect(messages.at(-1)?.system).toBe(true);
  });

  it("reads sender, text and time in utc+8", () => {
    const m = messages[1];
    expect(m.sender).toBe("Aminah");
    expect(m.text).toBe("Salam, report bulanan kosong");
    expect(m.at).toEqual(utc("2026-10-12T01:06:00Z"));
  });

  it("joins continuation lines to the message above", () => {
    expect(messages[2].text).toBe("IC saya 900101-14-5678\ndah cuba refresh");
  });

  it("handles pm", () => {
    expect(messages.find((m) => m.sender === "+60 12-345 6789")?.at).toEqual(utc("2026-10-13T06:15:00Z"));
  });

  it("picks up attachments", () => {
    const m = messages.find((x) => x.attachment);
    expect(m?.attachment).toBe("IMG-20261013-WA0001.jpg");
    expect(m?.text).toBe("Screen ni keluar error");
  });
});

describe("parseChat other formats", () => {
  it("reads 24 hour android", () => {
    const { messages } = parseChat(fixture("android-24h.txt"));
    expect(messages).toHaveLength(2);
    expect(messages[0].at).toEqual(utc("2026-10-13T13:05:00Z"));
  });

  it("reads iphone with seconds, brackets and the invisible mark", () => {
    const { messages } = parseChat(fixture("iphone.txt"));
    expect(messages).toHaveLength(4);
    expect(messages[0].at).toEqual(utc("2026-10-12T01:06:12Z"));
    expect(messages[2].attachment).toBe("00000012-PHOTO-2026-10-12-09-31-44.jpg");
    expect(messages[2].text).toBe("");
    expect(messages[3].at).toEqual(utc("2026-10-12T13:45:00Z"));
  });

  it("reads month first with two digit years", () => {
    const { messages, order } = parseChat(fixture("us-order.txt"));
    expect(order).toBe("mdy");
    expect(messages[0].at).toEqual(utc("2026-10-13T13:05:00Z"));
  });

  it("can be told the order", () => {
    const { messages } = parseChat("01/02/2026, 10:00 - A: hi", { order: "mdy" });
    expect(messages[0].at).toEqual(utc("2026-01-02T02:00:00Z"));
  });

  it("counts lines it can't place", () => {
    expect(parseChat("random first line\n12/10/2026, 10:00 - A: hi").skippedLines).toBe(1);
  });
});

describe("parseChat system lines", () => {
  const probes = [
    "Ali: I added Siti to the system but it fails",
    "Ali: Saya left the meeting early",
    "Ali: I joined yesterday",
    "Ali: I removed the file",
    "Ali: we changed the subject line",
    "Ali: is this end-to-end encrypted?",
    "Ali: security code changed when I login",
    "Ali: I created group in app",
  ];

  it.each(probes)("keeps client line as a message: %s", (body) => {
    const [m] = parseChat(`12/10/2026, 10:00 - ${body}`).messages;
    expect(m.system).toBe(false);
    expect(m.sender).toBe("Ali");
  });

  it.each(probes)("keeps iphone client line as a message: %s", (body) => {
    const [m] = parseChat(`[12/10/2026, 10:00:00] ${body}`).messages;
    expect(m.system).toBe(false);
  });

  it("marks iphone group lines as system", () => {
    const { messages } = parseChat(
      "[12/10/2026, 10:00:00] Support Group: \u200eAli added Siti\n" +
        "[12/10/2026, 10:01:00] Support Group: \u200eMessages and calls are end-to-end encrypted."
    );
    expect(messages.map((m) => m.system)).toEqual([true, true]);
  });

  it("marks android added lines with no sender as system", () => {
    expect(parseChat("12/10/2026, 10:00 - Ali added Siti").messages[0].system).toBe(true);
  });

  it("marks a subject change with a colon in it as system", () => {
    const [m] = parseChat('12/10/2026, 10:00 - Ali changed the subject from "A" to "Help: billing"').messages;
    expect(m.system).toBe(true);
  });
});

describe("parseChat edge cases", () => {
  it("reads malay pg and ptg markers", () => {
    const { messages } = parseChat("13/10/2026, 2:15 PTG - Aminah: hi\n13/10/2026, 9:00 pg - Aminah: pagi\n13/10/2026, 3:00 Petang - Aminah: lagi");
    expect(messages[0].sender).toBe("Aminah");
    expect(messages[0].at).toEqual(utc("2026-10-13T06:15:00Z"));
    expect(messages[1].at).toEqual(utc("2026-10-13T01:00:00Z"));
    expect(messages[2].at).toEqual(utc("2026-10-13T07:00:00Z"));
  });

  it("keeps a dated line without a separator as a continuation", () => {
    const { messages } = parseChat("12/10/2026, 9:00 - Ali: notes\n13/10/2026, 10:00 meeting with boss");
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("notes\n13/10/2026, 10:00 meeting with boss");
  });

  it("treats impossible dates and minutes as continuation", () => {
    const { messages, skippedLines } = parseChat(
      "30/02/2026, 10:00 - Ali: no\n12/10/2026, 9:00 - Ali: yes\n30/02/2026, 10:00 - Ali: feb\n12/10/2026, 10:61 - Ali: min"
    );
    expect(skippedLines).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0].text).toBe("yes\n30/02/2026, 10:00 - Ali: feb\n12/10/2026, 10:61 - Ali: min");
  });

  it("keeps long sender names", () => {
    const name = "Encik Ahmad bin Abdullah (Jabatan Kewangan Negeri Sembilan, Seremban)";
    const [m] = parseChat(`12/10/2026, 9:00 - ${name}: hello`).messages;
    expect(m.sender).toBe(name);
    expect(m.system).toBe(false);
  });

  it("reads android attachments with spaces in the name", () => {
    const [m] = parseChat("12/10/2026, 9:00 - Ali: Laporan Bulanan Okt.pdf (file attached)\nsila semak").messages;
    expect(m.attachment).toBe("Laporan Bulanan Okt.pdf");
    expect(m.text).toBe("sila semak");
  });

  it("finds iphone attachments anywhere in the text", () => {
    const [m] = parseChat("[12/10/2026, 09:00:00] Ali: \u200eReport.pdf \u2022 3 pages \u200e<attached: 00000013-Report.pdf>").messages;
    expect(m.attachment).toBe("00000013-Report.pdf");
    expect(m.text).toBe("Report.pdf \u2022 3 pages");
  });

  it("strips the invisible mark from text", () => {
    const [m] = parseChat("[12/10/2026, 09:00:00] Ali: \u200eimage omitted").messages;
    expect(m.text).toBe("image omitted");
  });

  it("reads a narrow no-break space before pm", () => {
    const [m] = parseChat("[12/10/2026, 9:45:00\u202fPM] Ali: hi").messages;
    expect(m.at).toEqual(utc("2026-10-12T13:45:00Z"));
    expect(m.sender).toBe("Ali");
  });

  it("reads windows line endings", () => {
    const { messages } = parseChat("12/10/2026, 9:00 - Ali: one\r\nmore\r\n12/10/2026, 9:01 - Ben: two\r\n");
    expect(messages.map((m) => m.text)).toEqual(["one\nmore", "two"]);
  });
});

const LRM = String.fromCharCode(0x200e);

describe("parseChat iphone group sender", () => {
  const head = `[12/10/2026, 09:00:00] Support Group: ${LRM}Messages and calls are end-to-end encrypted.\n`;

  it("marks any marked line from the group as system", () => {
    const { messages } = parseChat(
      head +
        `[12/10/2026, 09:01:00] Support Group: ${LRM}Ali pinned a message\n` +
        `[12/10/2026, 09:02:00] Support Group: ${LRM}You're now an admin`
    );
    expect(messages.map((m) => m.system)).toEqual([true, true, true]);
  });

  it("keeps a person's marked text as a message", () => {
    const { messages } = parseChat(head + `[12/10/2026, 09:01:00] Ali: ${LRM}Saya removed cache tapi masih error`);
    expect(messages[1].system).toBe(false);
    expect(messages[1].text).toBe("Saya removed cache tapi masih error");
  });

  it("keeps the earlier probes as messages with a group known", () => {
    const { messages } = parseChat(head + "[12/10/2026, 09:01:00] Ali: I added Siti to the system but it fails");
    expect(messages[1].system).toBe(false);
  });

  it("does not treat a 1:1 contact as the group", () => {
    const { messages } = parseChat(
      `[12/10/2026, 09:00:00] Ali: ${LRM}Messages and calls are end-to-end encrypted.\n` +
        "[12/10/2026, 09:01:00] Ali: hello\n" +
        `[12/10/2026, 09:02:00] Ali: ${LRM}<attached: 00000001-PHOTO.jpg>`
    );
    expect(messages.map((m) => m.system)).toEqual([true, false, false]);
  });
});

describe("parseChat minor rules", () => {
  it("marks a group name change with a colon as system", () => {
    expect(parseChat('12/10/2026, 10:00 - Ali changed the group name from "A" to "Help: b"').messages[0].system).toBe(true);
  });

  it("never takes a sender with a quote in it", () => {
    const [m] = parseChat('12/10/2026, 10:00 - Ali renamed "A: b"').messages;
    expect(m.sender).toBe("");
    expect(m.system).toBe(true);
  });

  it("only takes (file attached) at the end of the line", () => {
    const [m] = parseChat("12/10/2026, 10:00 - Ali: report.pdf (file attached) tolong semak").messages;
    expect(m.attachment).toBeNull();
  });
});

describe("parseChat seq", () => {
  it("numbers repeats in the same minute from the same sender", () => {
    const { messages } = parseChat(
      "12/10/2026, 10:00 - Ali: a.jpg (file attached)\n12/10/2026, 10:00 - Ali: b.jpg (file attached)\n12/10/2026, 10:00 - Ben: c.jpg (file attached)\n12/10/2026, 10:00 - Ali: hi"
    );
    expect(messages.map((m) => m.seq ?? 0)).toEqual([0, 1, 0, 0]);
  });
});
