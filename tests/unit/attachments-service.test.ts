import { describe, it, expect, vi, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { fileStore } from "@/lib/storage";
import { addAttachment } from "@/lib/attachments/service";

vi.mock("@/lib/storage", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/storage")>()),
  fileStore: vi.fn(),
}));
vi.mock("@/lib/tenant/context", () => ({ currentCompanyId: () => "co" }));
vi.mock("@/lib/attachments/process", () => ({ processAttachment: vi.fn(async (id: string) => ({ id })) }));

const attachment = (prisma as unknown as { attachment: Record<string, ReturnType<typeof vi.fn>> }).attachment;
const store = { get: vi.fn(), put: vi.fn(), remove: vi.fn(), removeFolder: vi.fn() };

beforeEach(() => {
  attachment.create.mockReset().mockResolvedValue({});
  vi.mocked(fileStore).mockReturnValue(store);
});

const savedName = () => attachment.create.mock.calls[0][0].data.fileName;

describe("addAttachment", () => {
  it("hides an IC number in the file name", async () => {
    await addAttachment({ ticketId: "t1", fileName: "IC 900101-14-5678.jpg", data: Buffer.from("x") });
    expect(savedName()).toBe("IC [IC HIDDEN].jpg");
  });

  it("falls back to a plain name when there is none", async () => {
    await addAttachment({ ticketId: "t1", fileName: "", data: Buffer.from("x") });
    expect(savedName()).toBe("screenshot.png");
  });
});
