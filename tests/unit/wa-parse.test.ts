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
