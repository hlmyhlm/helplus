import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { prisma, systemPrisma } from "@/lib/prisma";
import { runWithCompany } from "@/lib/tenant/context";
import { fileStore, importFileKey } from "@/lib/storage";
import { encryptBuffer } from "@/lib/secrets";
import { runImportBatch } from "@/lib/imports/run";
import { runImports } from "@/lib/jobs/imports";
import { closeOcr } from "@/lib/ocr/tesseract";
import { aiReady, sameProblem, tidyIssues } from "@/lib/imports/ai-tidy";

import { writeImportedTicket } from "@/lib/imports/write";

vi.mock("@/lib/imports/write", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/imports/write")>();
  return { ...real, writeImportedTicket: vi.fn(real.writeImportedTicket) };
});
vi.mock("@/lib/imports/ai-tidy", () => ({
  aiReady: vi.fn(async () => false),
  sameProblem: vi.fn(async () => false),
  tidyIssues: vi.fn(async () => new Map()),
}));

const A = "it-3b-run";
const asA = <T>(fn: () => Promise<T>) => runWithCompany(A, fn);
let dir: string;
let projectId: string;

const android = readFileSync(path.join(__dirname, "../fixtures/wa/android-en.txt"));

async function queueJob(kind: "whatsapp" | "csv", fileName: string, data: Buffer, options: Record<string, unknown>, project = projectId) {
  return asA(async () => {
    const job = await prisma.importJob.create({ data: { projectId: project, kind, fileName, options: options as never, status: "queued" } });
    const key = importFileKey(A, job.id);
    await fileStore().put(key, encryptBuffer(data));
    return prisma.importJob.update({ where: { id: job.id }, data: { fileKey: key } });
  });
}

const readJob = (id: string) => asA(() => prisma.importJob.findUniqueOrThrow({ where: { id } }));
const stats = (job: { stats: unknown }) => job.stats as Record<string, number>;

beforeAll(async () => {
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.company.create({ data: { id: A, name: "Run", slug: A } });
  projectId = (await asA(() => prisma.project.create({ data: { name: "General", isDefault: true } }))).id;
  dir = mkdtempSync(path.join(tmpdir(), "helplus-import-run-"));
  process.env.HELPLUS_STORAGE_DIR = dir;
});

afterAll(async () => {
  await closeOcr();
  await systemPrisma.company.deleteMany({ where: { id: A } });
  await systemPrisma.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

describe("whatsapp import", () => {
  it("writes the android fixture as 2 tickets and 1 draft", async () => {
    const job = await queueJob("whatsapp", "android-en.txt", android, { staff: ["Support Ali"] });
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("done");

    const tickets = await asA(() => prisma.ticket.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }));
    expect(tickets).toHaveLength(2);
    expect(tickets[0].status).toBe("closed");
    expect(tickets[0].description).toContain("[IC HIDDEN]");
    expect(tickets[1].status).toBe("new");
    expect(await asA(() => prisma.knowledgeEntry.count({ where: { status: "draft" } }))).toBe(1);

    const done = await readJob(job.id);
    expect(done.status).toBe("done");
    expect(done.finishedAt).not.toBeNull();
    expect(done.fileKey).toBeNull();
    await expect(fileStore().get(job.fileKey!)).rejects.toThrow();
    expect(stats(done)).toMatchObject({ created: 2, skipped: 0, announcements: 0, missingMedia: 1 });
  });

  it("skips everything when the same file comes in again, letting the writer top up known tickets", async () => {
    const known = await asA(() => prisma.ticket.findMany({ where: { projectId }, select: { importKey: true } }));
    const job = await queueJob("whatsapp", "android-en.txt", android, { staff: ["Support Ali"] });
    vi.mocked(writeImportedTicket).mockClear();
    await asA(() => runImports(new Date()));
    const keys = vi.mocked(writeImportedTicket).mock.calls.map((c) => c[0].importKey);
    expect(keys.sort()).toEqual(known.map((t) => t.importKey).sort());
    const done = await readJob(job.id);
    expect(done.status).toBe("done");
    expect(stats(done)).toMatchObject({ created: 0, skipped: 2 });
    expect(await asA(() => prisma.ticket.count({ where: { projectId } }))).toBe(2);
  });

  it("skips an issue an overlapping export cut in the middle", async () => {
    const first = [
      "5/4/2026, 10:00 - Cut Client: first part of the problem",
      "5/4/2026, 10:05 - Cut Client: second part of the problem",
      "5/4/2026, 10:10 - Support Ali: fixed it",
    ];
    const later = [...first.slice(1), "6/4/2026, 10:00 - Fresh Client: a brand new question"];
    const a = await queueJob("whatsapp", "cut-a.txt", Buffer.from(first.join("\n")), { staff: ["Support Ali"] });
    await asA(() => runImportBatch(a.id, new Date()));
    expect(stats(await readJob(a.id)).created).toBe(1);
    const b = await queueJob("whatsapp", "cut-b.txt", Buffer.from(later.join("\n")), { staff: ["Support Ali"] });
    vi.mocked(writeImportedTicket).mockClear();
    await asA(() => runImportBatch(b.id, new Date()));
    expect(stats(await readJob(b.id))).toMatchObject({ created: 1, skipped: 1 });
    // the cut issue never reaches the writer
    expect(vi.mocked(writeImportedTicket).mock.calls.map((c) => c[0].client.name)).toEqual(["Fresh Client"]);
  });

  it("carries on past an issue that fails to write", async () => {
    const chat = [
      "7/5/2026, 10:00 - Fail Client: this one breaks",
      "7/5/2026, 16:00 - Fine Client: this one is fine",
    ].join("\n");
    vi.mocked(writeImportedTicket).mockRejectedValueOnce(new Error("clash for IC 900101-14-5678"));
    const job = await queueJob("whatsapp", "fail.txt", Buffer.from(chat), { staff: [] });
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("done");
    const done = await readJob(job.id);
    expect(stats(done)).toMatchObject({ created: 1, failed: 1 });
    const errors = (done.progress as { errors: string[] }).errors;
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Fail Client");
    expect(errors[0]).not.toContain("900101");
  });

  it("fails with a message and keeps the file when the export is bad", async () => {
    const job = await queueJob("whatsapp", "broken.zip", Buffer.from("not a zip"), {});
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("failed");
    const failed = await readJob(job.id);
    expect(failed.error).toBe("This isn't a WhatsApp export");
    expect(failed.fileKey).not.toBeNull();
    await asA(() => prisma.importJob.delete({ where: { id: job.id } }));
  });

  it("runs a big chat over several batches", { timeout: 120_000 }, async () => {
    const lines: string[] = [];
    const start = Date.UTC(2025, 0, 1, 0, 0);
    for (let i = 0; i < 205; i++) {
      const d = new Date(start + i * 5 * 3600_000);
      const date = `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:00`;
      lines.push(`${date} - Batch Client ${i}: help with thing ${i}`);
    }
    const job = await queueJob("whatsapp", "big.txt", Buffer.from(lines.join("\n")), { staff: [] });
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("running");
    const mid = await readJob(job.id);
    expect((mid.progress as { next: number }).next).toBe(200);
    expect(stats(mid).created).toBe(200);
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("done");
    expect(stats(await readJob(job.id)).created).toBe(205);
  });
});

describe("ai tidy", () => {
  const chat = [
    "1/3/2026, 09:00 - Merge Client: printer is jammed",
    "1/3/2026, 15:00 - Merge Client: still jammed, any update?",
    "1/3/2026, 15:10 - Support Ali: Open the back tray",
    "2/3/2026, 09:00 - Other Client: new question",
  ].join("\n");

  it("folds a split issue into the next one, even across batches", async () => {
    vi.mocked(aiReady).mockResolvedValue(true);
    vi.mocked(sameProblem).mockResolvedValue(true);
    vi.mocked(tidyIssues).mockImplementation(async (list) => new Map(list.map((i) => [i.key, { title: "Printer jam", category: "Hardware" }])));
    try {
      const job = await queueJob("whatsapp", "merge.txt", Buffer.from(chat), { staff: ["Support Ali"] });
      expect(await asA(() => runImportBatch(job.id, new Date(), 1))).toBe("running");
      expect(stats(await readJob(job.id)).created).toBe(0);
      expect(await asA(() => runImportBatch(job.id, new Date(), 1))).toBe("running");
      expect(await asA(() => runImportBatch(job.id, new Date(), 1))).toBe("done");
      const t = await asA(() => prisma.ticket.findFirstOrThrow({ where: { title: "Printer jam", category: "Hardware", status: "closed" } }));
      const msgs = await asA(() => prisma.message.count({ where: { conversationId: t.conversationId! } }));
      expect(msgs).toBe(3);
      expect(stats(await readJob(job.id)).created).toBe(2);
      // the other client's issue was never a merge candidate
      expect(vi.mocked(sameProblem)).toHaveBeenCalledTimes(1);
    } finally {
      vi.mocked(aiReady).mockResolvedValue(false);
      vi.mocked(sameProblem).mockResolvedValue(false);
      vi.mocked(tidyIssues).mockResolvedValue(new Map());
    }
  });
});

describe("csv import", () => {
  const csv = [
    "Ticket ID,Question,Answer,Created",
    "T1,Can't login,Reset the password,01/02/2026",
    "T2,Report is empty,Clear the cache,02/02/2026",
    "T3,Slow page,,03/02/2026",
    "T4,,No question here,04/02/2026",
    "T5,Bad date,Answer,99/99/2026",
    "T6,IC in the date,Answer,900101-14-5678",
  ].join("\n");
  const options = {
    order: "dmy",
    mapping: { oldId: "Ticket ID", question: "Question", answer: "Answer", createdAt: "Created" },
  };

  it("writes the good rows as closed tickets and keeps the bad ones", async () => {
    const job = await queueJob("csv", "old.csv", Buffer.from(csv), options);
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("done");
    const tickets = await asA(() => prisma.ticket.findMany({ where: { importKey: { startsWith: "csv:" } } }));
    expect(tickets).toHaveLength(3);
    expect(tickets.every((t) => /^csv:[0-9a-f]{64}$/.test(t.importKey!))).toBe(true);
    expect(tickets.every((t) => t.status === "closed" && t.closedAt)).toBe(true);
    const done = await readJob(job.id);
    const bad = done.badRows as { reason: string }[];
    expect(bad.map((b) => b.reason)).toEqual([
      "Missing question",
      "Can't read date: 99/99/2026",
      "Can't read date: [IC HIDDEN]",
    ]);
    expect(JSON.stringify(done.badRows)).not.toContain("900101");
    expect(stats(done)).toMatchObject({ created: 3, bad: 3 });
    const convo = await asA(() => prisma.conversation.findUniqueOrThrow({ where: { id: tickets[0].conversationId! } }));
    expect(convo.channel).toBe("import");
    const saved = await asA(() => prisma.importMapping.findFirst({ where: { headers: "ticket id|question|answer|created" } }));
    expect(saved?.mapping).toEqual(options.mapping);
  });

  it("creates nothing on a second import of the same file", async () => {
    const job = await queueJob("csv", "old.csv", Buffer.from(csv), options);
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("done");
    expect(stats(await readJob(job.id))).toMatchObject({ created: 0, skipped: 3 });
  });

  it("keeps the same old id apart in two projects", async () => {
    const other = (await asA(() => prisma.project.create({ data: { name: "Second client" } }))).id;
    const map = { mapping: { oldId: "ID", question: "Question", answer: "Answer" } };
    const a = await queueJob("csv", "p1.csv", Buffer.from("ID,Question,Answer\nSAME1,first client asks,first answer"), map);
    const b = await queueJob("csv", "p2.csv", Buffer.from("ID,Question,Answer\nSAME1,second client asks,second answer"), map, other);
    expect(await asA(() => runImportBatch(a.id, new Date()))).toBe("done");
    expect(await asA(() => runImportBatch(b.id, new Date()))).toBe("done");
    expect(stats(await readJob(b.id))).toMatchObject({ created: 1, skipped: 0 });
    const tickets = await asA(() =>
      prisma.ticket.findMany({ where: { description: { in: ["first client asks", "second client asks"] } } })
    );
    expect(tickets.map((t) => t.projectId).sort()).toEqual([projectId, other].sort());
    expect(tickets.every((t) => !t.importKey!.includes("SAME1"))).toBe(true);
    const drafts = await asA(() => prisma.knowledgeEntry.findMany({ where: { sourceTicketId: { in: tickets.map((t) => t.id) } } }));
    expect(drafts).toHaveLength(2);
    for (const d of drafts) {
      const t = tickets.find((x) => x.id === d.sourceTicketId)!;
      expect(d.projectId).toBe(t.projectId);
      expect(d.content).toContain(t.projectId === other ? "second answer" : "first answer");
    }
  });
});

describe("ic in a sender name", () => {
  it("stores the name masked and still matches staff", async () => {
    const chat = [
      "1/6/2026, 10:00 - Ic Client: my report is blank",
      "1/6/2026, 10:05 - Ali 900101-14-5678: try logging in again",
    ].join("\n");
    const job = await queueJob("whatsapp", "ic.txt", Buffer.from(chat), { staff: ["Ali [IC HIDDEN]"] });
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("done");
    const t = await asA(() => prisma.ticket.findFirstOrThrow({ where: { description: { contains: "my report is blank" } } }));
    expect(t.status).toBe("closed");
    const roles = await asA(() =>
      prisma.message.findMany({ where: { conversationId: t.conversationId! }, orderBy: { createdAt: "asc" }, select: { role: true } })
    );
    expect(roles.map((r) => r.role)).toEqual(["customer", "agent"]);
  });
});

describe("time budget", () => {
  it("stops a whatsapp batch early and the next one carries on", async () => {
    const chat = [
      "1/8/2026, 09:00 - Budget One: budget first",
      "1/8/2026, 15:00 - Budget Two: budget second",
      "1/8/2026, 21:00 - Budget Three: budget third",
    ].join("\n");
    const job = await queueJob("whatsapp", "budget.txt", Buffer.from(chat), { staff: [] });
    expect(await asA(() => runImportBatch(job.id, new Date(), 200, 0))).toBe("running");
    const mid = await readJob(job.id);
    expect((mid.progress as { next: number }).next).toBe(1);
    expect(stats(mid)).toMatchObject({ created: 1, skipped: 0 });
    expect(await asA(() => runImportBatch(job.id, new Date(), 200, 0))).toBe("running");
    expect(await asA(() => runImportBatch(job.id, new Date(), 200, 0))).toBe("done");
    expect(stats(await readJob(job.id))).toMatchObject({ created: 3, skipped: 0 });
    expect(await asA(() => prisma.ticket.count({ where: { description: { startsWith: "budget " } } }))).toBe(3);
  });

  it("keeps merged issues together when the budget cuts a batch", async () => {
    vi.mocked(aiReady).mockResolvedValue(true);
    vi.mocked(sameProblem).mockResolvedValue(true);
    try {
      const chat = [
        "1/9/2026, 09:00 - Budget Merge: modem is down",
        "1/9/2026, 15:00 - Budget Merge: still down",
        "1/9/2026, 15:10 - Support Ali: restart it",
        "2/9/2026, 09:00 - Budget Next: something else",
      ].join("\n");
      const job = await queueJob("whatsapp", "budget-merge.txt", Buffer.from(chat), { staff: ["Support Ali"] });
      let runs = 0;
      while ((await asA(() => runImportBatch(job.id, new Date(), 200, 0))) === "running") runs++;
      expect(runs).toBeGreaterThan(0);
      const done = await readJob(job.id);
      expect(done.status).toBe("done");
      expect(stats(done)).toMatchObject({ created: 2, skipped: 0, failed: 0 });
      const t = await asA(() => prisma.ticket.findFirstOrThrow({ where: { description: { contains: "modem is down" } } }));
      expect(await asA(() => prisma.message.count({ where: { conversationId: t.conversationId! } }))).toBe(3);
    } finally {
      vi.mocked(aiReady).mockResolvedValue(false);
      vi.mocked(sameProblem).mockResolvedValue(false);
    }
  });

  it("takes smaller batches with AI on so slow titles don't eat the budget", { timeout: 60_000 }, async () => {
    vi.mocked(aiReady).mockResolvedValue(true);
    const titled: string[] = [];
    vi.mocked(tidyIssues).mockImplementation(async (list) => {
      await new Promise((r) => setTimeout(r, 50));
      titled.push(...list.map((i) => i.key));
      return new Map();
    });
    try {
      const lines: string[] = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(Date.UTC(2026, 9, 1) + i * 5 * 3600_000);
        const date = `${d.getUTCDate()}/${d.getUTCMonth() + 1}/${d.getUTCFullYear()}, ${String(d.getUTCHours()).padStart(2, "0")}:00`;
        lines.push(`${date} - Slow Client ${i}: slow title ${i}`);
      }
      const job = await queueJob("whatsapp", "slow.txt", Buffer.from(lines.join("\n")), { staff: [] });
      expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("running");
      const mid = await readJob(job.id);
      expect((mid.progress as { next: number }).next).toBe(25);
      expect(stats(mid).created).toBe(25);
      expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("done");
      expect(stats(await readJob(job.id)).created).toBe(30);
      expect(titled).toHaveLength(30);
      expect(new Set(titled).size).toBe(30);
    } finally {
      vi.mocked(aiReady).mockResolvedValue(false);
      vi.mocked(tidyIssues).mockReset();
      vi.mocked(tidyIssues).mockResolvedValue(new Map());
    }
  });

  it("stops a csv batch early and the next one carries on", async () => {
    const csv = "ID,Question\nB1,budget row one\nB2,budget row two\nB3,budget row three";
    const job = await queueJob("csv", "budget.csv", Buffer.from(csv), { mapping: { oldId: "ID", question: "Question" } });
    expect(await asA(() => runImportBatch(job.id, new Date(), 200, 0))).toBe("running");
    expect((await readJob(job.id)).progress).toMatchObject({ next: 1 });
    expect(await asA(() => runImportBatch(job.id, new Date(), 200, 0))).toBe("running");
    expect(await asA(() => runImportBatch(job.id, new Date(), 200, 0))).toBe("done");
    expect(stats(await readJob(job.id))).toMatchObject({ created: 3, skipped: 0 });
    expect(await asA(() => prisma.ticket.count({ where: { description: { startsWith: "budget row" } } }))).toBe(3);
  });
});

describe("failures", () => {
  it("fails with a plain message when the stored file is gone", async () => {
    const job = await queueJob("csv", "gone.csv", Buffer.from("ID,Question\nG1,gone"), { mapping: { oldId: "ID", question: "Question" } });
    await fileStore().remove(job.fileKey!);
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("failed");
    const failed = await readJob(job.id);
    expect(failed.error).toBe("The uploaded file is gone, upload it again");
    expect(failed.fileKey).toBeNull();
  });

  it("keeps the file key when the file can't be read for another reason", async () => {
    const job = await queueJob("csv", "unreadable.csv", Buffer.from("ID,Question\nU1,unreadable"), { mapping: { oldId: "ID", question: "Question" } });
    await asA(() => prisma.importJob.update({ where: { id: job.id }, data: { fileKey: "../not-a-key" } }));
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("failed");
    const failed = await readJob(job.id);
    expect(failed.error).toBe("Something went wrong with this import, try again");
    expect(failed.fileKey).toBe("../not-a-key");
  });

  it("never stores a raw error in the job", async () => {
    const job = await queueJob("whatsapp", "raw.txt", Buffer.from("3/6/2026, 10:00 - Raw Client: hello"), {});
    vi.mocked(tidyIssues).mockRejectedValueOnce(new Error(`ENOENT: no such file ${dir}`));
    expect(await asA(() => runImportBatch(job.id, new Date()))).toBe("failed");
    const failed = await readJob(job.id);
    expect(failed.error).toBe("Something went wrong with this import, try again");
    expect(failed.finishedAt).not.toBeNull();
  });

  it("never flips a job another run already finished", async () => {
    const job = await queueJob("whatsapp", "race.txt", Buffer.from("2/6/2026, 10:00 - Race Client: hello"), {});
    vi.mocked(tidyIssues).mockImplementationOnce(async () => {
      await asA(() => prisma.importJob.update({ where: { id: job.id }, data: { status: "done" } }));
      throw new Error("boom");
    });
    await asA(() => runImportBatch(job.id, new Date()));
    const after = await readJob(job.id);
    expect(after.status).toBe("done");
    expect(after.error).toBe("");
  });
});

describe("runImports", () => {
  it("clears out uploads nobody started within 7 days", async () => {
    const make = (daysAgo: number) =>
      asA(async () => {
        const job = await prisma.importJob.create({
          data: { projectId, kind: "csv", status: "uploaded", createdAt: new Date(Date.now() - daysAgo * 86_400_000) },
        });
        const key = importFileKey(A, job.id);
        await fileStore().put(key, encryptBuffer(Buffer.from("x")));
        return prisma.importJob.update({ where: { id: job.id }, data: { fileKey: key } });
      });
    const old = await make(8);
    const fresh = await make(1);
    await asA(() => runImports(new Date()));
    expect(await asA(() => prisma.importJob.findFirst({ where: { id: old.id } }))).toBeNull();
    await expect(fileStore().get(old.fileKey!)).rejects.toThrow();
    expect((await readJob(fresh.id)).status).toBe("uploaded");
    await expect(fileStore().get(fresh.fileKey!)).resolves.toBeTruthy();
  });

  it("drops the file of an import that failed over 14 days ago but keeps the row", async () => {
    const make = (daysAgo: number) =>
      asA(async () => {
        const job = await prisma.importJob.create({
          data: { projectId, kind: "csv", status: "failed", error: "x", finishedAt: new Date(Date.now() - daysAgo * 86_400_000) },
        });
        const key = importFileKey(A, job.id);
        await fileStore().put(key, encryptBuffer(Buffer.from("x")));
        return prisma.importJob.update({ where: { id: job.id }, data: { fileKey: key } });
      });
    const old = await make(15);
    const fresh = await make(2);
    await asA(() => runImports(new Date()));
    const kept = await readJob(old.id);
    expect(kept.status).toBe("failed");
    expect(kept.fileKey).toBeNull();
    await expect(fileStore().get(old.fileKey!)).rejects.toThrow();
    expect((await readJob(fresh.id)).fileKey).toBe(fresh.fileKey);
    await expect(fileStore().get(fresh.fileKey!)).resolves.toBeTruthy();
  });

  it("takes one job per company per run, oldest first", async () => {
    const first = await queueJob("csv", "a.csv", Buffer.from("ID,Question\nR1,one"), { mapping: { oldId: "ID", question: "Question" } });
    const second = await queueJob("csv", "b.csv", Buffer.from("ID,Question\nR2,two"), { mapping: { oldId: "ID", question: "Question" } });
    await asA(() => runImports(new Date()));
    expect((await readJob(first.id)).status).toBe("done");
    expect((await readJob(second.id)).status).toBe("queued");
    await asA(() => runImports(new Date()));
    expect((await readJob(second.id)).status).toBe("done");
  });
});
