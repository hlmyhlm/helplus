import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { fileStore } from "@/lib/storage";
import { ocrImage } from "@/lib/ocr/tesseract";
import { processAttachment } from "@/lib/attachments/process";

vi.mock("@/lib/storage", () => ({ fileStore: vi.fn(), attachmentKey: vi.fn(() => "c/co/attachments/a1/masked.png") }));
vi.mock("@/lib/ocr/tesseract", () => ({ ocrImage: vi.fn() }));
vi.mock("@/lib/tenant/context", () => ({ currentCompanyId: () => "co" }));

const attachment = (prisma as unknown as { attachment: Record<string, ReturnType<typeof vi.fn>> }).attachment;
const put = vi.fn();

beforeEach(() => {
  for (const fn of Object.values(attachment)) fn.mockReset();
  put.mockReset();
  vi.mocked(ocrImage).mockReset();
  attachment.findUnique.mockResolvedValue({ id: "a1", status: "pending", originalKey: "c/co/attachments/a1/original.bin" });
  attachment.update.mockImplementation(async ({ data }) => ({ id: "a1", ...data }));
});

const expectUnreadable = () => {
  expect(attachment.update).toHaveBeenCalledWith({
    where: { id: "a1" },
    data: { status: "needs_check", checkNote: "Couldn't read the original file." },
  });
  expect(put).not.toHaveBeenCalled();
  expect(ocrImage).not.toHaveBeenCalled();
};

describe("processAttachment with a bad original", () => {
  it("marks it needs_check when storage can't read the file", async () => {
    vi.mocked(fileStore).mockReturnValue({ get: vi.fn().mockRejectedValue(new Error("ENOENT")), put, remove: vi.fn() });
    const a = await processAttachment("a1");
    expect(a?.status).toBe("needs_check");
    expectUnreadable();
  });

  it("marks it needs_check when the original won't decrypt", async () => {
    vi.mocked(fileStore).mockReturnValue({ get: vi.fn().mockResolvedValue(Buffer.from("not encrypted")), put, remove: vi.fn() });
    const a = await processAttachment("a1");
    expect(a?.status).toBe("needs_check");
    expectUnreadable();
  });
});
