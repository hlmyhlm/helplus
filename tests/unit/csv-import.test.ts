import { describe, expect, it } from "vitest";
import { readCsv, headersSignature } from "@/lib/imports/csv/parse";
import {
  badRowsCsv,
  checkRows,
  guessMapping,
  parseLooseDate,
  type CsvMapping,
} from "@/lib/imports/csv/rows";

describe("readCsv", () => {
  it("reads quoted fields with commas and newlines", () => {
    const text = 'ID,Question\n1,"Hello, world\nsecond line"\n';
    const { headers, rows } = readCsv(text);
    expect(headers).toEqual(["ID", "Question"]);
    expect(rows).toEqual([{ ID: "1", Question: "Hello, world\nsecond line" }]);
  });

  it("ignores a BOM", () => {
    const text = "﻿ID,Question\n1,Hi\n";
    const { headers } = readCsv(text);
    expect(headers).toEqual(["ID", "Question"]);
  });

  it("trims header names", () => {
    const text = " ID , Question \n1,Hi\n";
    const { headers } = readCsv(text);
    expect(headers).toEqual(["ID", "Question"]);
  });

  it("skips fully empty lines", () => {
    const text = "ID,Question\n1,Hi\n\n2,Bye\n";
    const { rows } = readCsv(text);
    expect(rows).toEqual([
      { ID: "1", Question: "Hi" },
      { ID: "2", Question: "Bye" },
    ]);
  });
});

describe("headersSignature", () => {
  it("lower-cases, trims and joins headers with |", () => {
    expect(headersSignature([" ID ", "Question", "Answer"])).toBe("id|question|answer");
  });
});

describe("guessMapping", () => {
  it("maps ID / Ticket ID / No to oldId", () => {
    expect(guessMapping(["ID"]).oldId).toBe("ID");
    expect(guessMapping(["Ticket ID"]).oldId).toBe("Ticket ID");
    expect(guessMapping(["No"]).oldId).toBe("No");
  });

  it("maps Question / Issue / Description / Masalah to question", () => {
    expect(guessMapping(["Question"]).question).toBe("Question");
    expect(guessMapping(["Issue"]).question).toBe("Issue");
    expect(guessMapping(["Description"]).question).toBe("Description");
    expect(guessMapping(["Masalah"]).question).toBe("Masalah");
  });

  it("maps Answer / Reply / Solution / Jawapan to answer", () => {
    expect(guessMapping(["Answer"]).answer).toBe("Answer");
    expect(guessMapping(["Reply"]).answer).toBe("Reply");
    expect(guessMapping(["Solution"]).answer).toBe("Solution");
    expect(guessMapping(["Jawapan"]).answer).toBe("Jawapan");
  });

  it("maps Client / Customer / Name to clientName", () => {
    expect(guessMapping(["Client"]).clientName).toBe("Client");
    expect(guessMapping(["Customer"]).clientName).toBe("Customer");
    expect(guessMapping(["Name"]).clientName).toBe("Name");
  });

  it("maps Phone / Email / Contact to clientContact", () => {
    expect(guessMapping(["Phone"]).clientContact).toBe("Phone");
    expect(guessMapping(["Email"]).clientContact).toBe("Email");
    expect(guessMapping(["Contact"]).clientContact).toBe("Contact");
  });

  it("maps Created / Date / Tarikh to createdAt", () => {
    expect(guessMapping(["Created"]).createdAt).toBe("Created");
    expect(guessMapping(["Date"]).createdAt).toBe("Date");
    expect(guessMapping(["Tarikh"]).createdAt).toBe("Tarikh");
  });

  it("maps Closed / Resolved to closedAt", () => {
    expect(guessMapping(["Closed"]).closedAt).toBe("Closed");
    expect(guessMapping(["Resolved"]).closedAt).toBe("Resolved");
  });

  it("maps Category and Priority directly", () => {
    expect(guessMapping(["Category"]).category).toBe("Category");
    expect(guessMapping(["Priority"]).priority).toBe("Priority");
  });

  it("matches case-insensitively and on contains", () => {
    const mapping = guessMapping(["ticket id", "Issue Description", "Primary Contact Number"]);
    expect(mapping.oldId).toBe("ticket id");
    expect(mapping.question).toBe("Issue Description");
    expect(mapping.clientContact).toBe("Primary Contact Number");
  });

  it("sends Client Phone to clientContact and Client Name to clientName", () => {
    const mapping = guessMapping(["Client Phone", "Client Name"]);
    expect(mapping.clientContact).toBe("Client Phone");
    expect(mapping.clientName).toBe("Client Name");
  });

  it("sends Client Email to clientContact", () => {
    expect(guessMapping(["Client Email"]).clientContact).toBe("Client Email");
  });

  it("maps both date columns correctly even though both mention Date", () => {
    const mapping = guessMapping(["Created Date", "Closed Date"]);
    expect(mapping.createdAt).toBe("Created Date");
    expect(mapping.closedAt).toBe("Closed Date");
  });

  it("keeps plain Name and Phone headers distinct", () => {
    const mapping = guessMapping(["Name", "Phone"]);
    expect(mapping.clientName).toBe("Name");
    expect(mapping.clientContact).toBe("Phone");
  });

  it("uses the last word to split Contact Name from Contact Phone", () => {
    const mapping = guessMapping(["Contact Name", "Contact Phone"]);
    expect(mapping.clientName).toBe("Contact Name");
    expect(mapping.clientContact).toBe("Contact Phone");
  });

  it("uses the last word to split Customer Contact Name from Customer Contact Phone", () => {
    const mapping = guessMapping(["Customer Contact Name", "Customer Contact Phone"]);
    expect(mapping.clientName).toBe("Customer Contact Name");
    expect(mapping.clientContact).toBe("Customer Contact Phone");
  });

  it("uses the last word to split Contact Name from Contact Email", () => {
    const mapping = guessMapping(["Contact Name", "Contact Email"]);
    expect(mapping.clientName).toBe("Contact Name");
    expect(mapping.clientContact).toBe("Contact Email");
  });

  it("maps Malay question/answer/name headers", () => {
    const mapping = guessMapping(["Nama Pelanggan", "Masalah", "Jawapan"]);
    expect(mapping.question).toBe("Masalah");
    expect(mapping.answer).toBe("Jawapan");
    expect(mapping.clientName).toBe("Nama Pelanggan");
  });

  it("maps both date columns correctly regardless of column order", () => {
    const mapping = guessMapping(["Closed Date", "Created Date"]);
    expect(mapping.closedAt).toBe("Closed Date");
    expect(mapping.createdAt).toBe("Created Date");
  });

  it("uses the qualifier word, not the generic Date, to tell Resolved Date from a plain Date", () => {
    const mapping = guessMapping(["Resolved Date", "Date"]);
    expect(mapping.closedAt).toBe("Resolved Date");
    expect(mapping.createdAt).toBe("Date");
  });

  it("maps a bare Date header to createdAt", () => {
    expect(guessMapping(["Date"]).createdAt).toBe("Date");
  });

  it("never sends a header ending in a date word to a text field", () => {
    const mapping = guessMapping(["Issue Date", "Question"]);
    expect(mapping.createdAt).toBe("Issue Date");
    expect(mapping.question).toBe("Question");
  });

  it("maps Malay date headers by their qualifier word", () => {
    const mapping = guessMapping(["Tarikh Tutup", "Tarikh"]);
    expect(mapping.closedAt).toBe("Tarikh Tutup");
    expect(mapping.createdAt).toBe("Tarikh");
  });

  it("never sends a header ending in a number word to oldId", () => {
    const mapping = guessMapping([
      "Customer Name",
      "Phone No",
      "Issue",
      "Reply",
      "Status",
      "Created At",
    ]);
    expect(mapping.clientContact).toBe("Phone No");
    expect(mapping.oldId).toBeUndefined();
    expect(mapping.createdAt).toBe("Created At");
  });

  it("sends Contact No to clientContact, not oldId", () => {
    const mapping = guessMapping(["Contact Name", "Contact No"]);
    expect(mapping.clientName).toBe("Contact Name");
    expect(mapping.clientContact).toBe("Contact No");
  });

  it("still sends a real ID header to oldId alongside a phone number header", () => {
    const mapping = guessMapping(["Ticket No", "Phone Number"]);
    expect(mapping.oldId).toBe("Ticket No");
    expect(mapping.clientContact).toBe("Phone Number");
  });

  it("maps Malay client/contact/question/answer/date headers together", () => {
    const mapping = guessMapping(["Nama", "No Telefon", "Masalah", "Jawapan", "Tarikh"]);
    expect(mapping.clientName).toBe("Nama");
    expect(mapping.clientContact).toBe("No Telefon");
    expect(mapping.question).toBe("Masalah");
    expect(mapping.answer).toBe("Jawapan");
    expect(mapping.createdAt).toBe("Tarikh");
  });
});

describe("checkRows", () => {
  const mapping: CsvMapping = {
    oldId: "ID",
    question: "Question",
    answer: "Answer",
    createdAt: "Created",
    closedAt: "Closed",
  };

  it("flags a missing ID", () => {
    const { good, bad } = checkRows([{ ID: "", Question: "Why?" }], mapping, "dmy");
    expect(good).toHaveLength(0);
    expect(bad).toEqual([{ line: 2, reason: "Missing ID", raw: { ID: "", Question: "Why?" } }]);
  });

  it("flags a missing question", () => {
    const { good, bad } = checkRows([{ ID: "1", Question: "" }], mapping, "dmy");
    expect(good).toHaveLength(0);
    expect(bad).toEqual([{ line: 2, reason: "Missing question", raw: { ID: "1", Question: "" } }]);
  });

  it("flags an ID repeated in the file, keeping the first good", () => {
    const rows = [
      { ID: "1", Question: "First" },
      { ID: "1", Question: "Second" },
    ];
    const { good, bad } = checkRows(rows, mapping, "dmy");
    expect(good).toHaveLength(1);
    expect(good[0]).toMatchObject({ line: 2, oldId: "1", question: "First" });
    expect(bad).toEqual([
      { line: 3, reason: "ID repeated in the file", raw: rows[1] },
    ]);
  });

  it("flags an unreadable date in a mapped date column", () => {
    const { good, bad } = checkRows(
      [{ ID: "1", Question: "Why?", Created: "yesterday" }],
      mapping,
      "dmy"
    );
    expect(good).toHaveLength(0);
    expect(bad).toEqual([
      {
        line: 2,
        reason: "Can't read date: yesterday",
        raw: { ID: "1", Question: "Why?", Created: "yesterday" },
      },
    ]);
  });

  it("masks an IC sitting in a bad date cell", () => {
    const { bad } = checkRows([{ ID: "1", Question: "Why?", Closed: "900101-14-5678" }], mapping, "dmy");
    expect(bad[0].reason).toBe("Can't read date: [IC HIDDEN]");
  });

  it("returns good rows with trimmed values and correct line numbers", () => {
    const rows = [
      { ID: " 1 ", Question: " Why? ", Answer: " Because ", Created: "", Closed: "" },
      { ID: "2", Question: "How?", Answer: "", Created: "", Closed: "" },
    ];
    const { good, bad } = checkRows(rows, mapping, "dmy");
    expect(bad).toHaveLength(0);
    expect(good).toEqual([
      {
        line: 2,
        oldId: "1",
        question: "Why?",
        answer: "Because",
        title: "",
        clientName: "",
        clientContact: "",
        createdAt: null,
        closedAt: null,
        category: "",
        priority: "",
      },
      {
        line: 3,
        oldId: "2",
        question: "How?",
        answer: "",
        title: "",
        clientName: "",
        clientContact: "",
        createdAt: null,
        closedAt: null,
        category: "",
        priority: "",
      },
    ]);
  });
});

describe("parseLooseDate", () => {
  const expected = new Date(Date.UTC(2026, 9, 12, 0, 0, 0) - 480 * 60_000);
  const expectedWithTime = new Date(Date.UTC(2026, 9, 12, 14, 30, 0) - 480 * 60_000);

  it("reads ISO dates without a time", () => {
    expect(parseLooseDate("2026-10-12", "dmy")).toEqual(expected);
  });

  it("reads ISO dates with a time", () => {
    expect(parseLooseDate("2026-10-12 14:30", "dmy")).toEqual(expectedWithTime);
  });

  it("reads slash dates in day/month order", () => {
    expect(parseLooseDate("12/10/2026", "dmy")).toEqual(expected);
  });

  it("reads slash dates with a 12-hour time", () => {
    expect(parseLooseDate("12/10/2026 2:30 PM", "dmy")).toEqual(expectedWithTime);
  });

  it("reads slash dates in month/day order", () => {
    expect(parseLooseDate("10/12/2026", "mdy")).toEqual(expected);
  });

  it("returns null for unreadable text", () => {
    expect(parseLooseDate("yesterday", "dmy")).toBeNull();
  });

  it("rejects impossible dates instead of rolling them over", () => {
    expect(parseLooseDate("31/02/2026", "dmy")).toBeNull();
  });

  it("uses a custom offset when given one", () => {
    const utcDate = parseLooseDate("2026-10-12 00:00", "dmy", 0);
    expect(utcDate).toEqual(new Date(Date.UTC(2026, 9, 12, 0, 0, 0)));
  });

  it("pivots two-digit years at 70", () => {
    expect(parseLooseDate("12/10/26", "dmy")).toEqual(expected);
    expect(parseLooseDate("12/10/75", "dmy")).toEqual(
      new Date(Date.UTC(1975, 9, 12, 0, 0, 0) - 480 * 60_000)
    );
  });

  it("rejects a 12-hour time whose hour is above 12 or is 0 with am/pm given", () => {
    expect(parseLooseDate("12/10/2026 13:30 PM", "dmy")).toBeNull();
    expect(parseLooseDate("12/10/2026 0:30 AM", "dmy")).toBeNull();
  });
});

describe("badRowsCsv", () => {
  it("writes a reason column first, then the original columns, quoted correctly", () => {
    const bad = [
      { line: 2, reason: "Missing ID", raw: { ID: "", Question: "Hello, world" } },
      { line: 3, reason: "Missing question", raw: { ID: "2", Question: "" } },
    ];
    const csv = badRowsCsv(bad);
    expect(csv).toBe(
      'reason,ID,Question\r\nMissing ID,,"Hello, world"\r\nMissing question,2,'
    );
  });

  it("returns just the header when there are no bad rows", () => {
    expect(badRowsCsv([])).toBe("reason");
  });

  it("prefixes cells that could be read as a spreadsheet formula", () => {
    const bad = [
      {
        line: 2,
        reason: '=HYPERLINK("http://evil")',
        raw: { ID: "+1", Question: "-2", Note: "@x" },
      },
    ];
    const csv = badRowsCsv(bad);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("'+1");
    expect(csv).toContain("'-2");
    expect(csv).toContain("'@x");
  });
});
