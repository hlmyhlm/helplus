import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createWorker } from "tesseract.js";
import { ocrImage, closeOcr } from "@/lib/ocr/tesseract";

vi.mock("fs/promises", () => ({ mkdir: vi.fn().mockResolvedValue(undefined) }));
vi.mock("tesseract.js", () => ({ createWorker: vi.fn() }));

const page = { confidence: 91, blocks: [{ paragraphs: [{ lines: [{ words: [{ text: "hi", confidence: 90, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } }] }] }] }] };

function fakeWorker(recognize: () => Promise<unknown>) {
  return { recognize: vi.fn(recognize), terminate: vi.fn().mockResolvedValue(undefined) };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.mocked(createWorker).mockReset();
});

afterEach(async () => {
  await closeOcr();
  vi.useRealTimers();
});

describe("ocrImage", () => {
  it("maps blocks to lines of words", async () => {
    vi.mocked(createWorker).mockResolvedValue(fakeWorker(async () => ({ data: page })) as never);
    const r = await ocrImage(Buffer.from("png"));
    expect(r).toEqual({ confidence: 91, lines: [{ words: [{ text: "hi", confidence: 90, bbox: { x0: 1, y0: 2, x1: 3, y1: 4 } }] }] });
  });

  it("keeps the worker after a bad image", async () => {
    const w = fakeWorker(async () => {
      throw new Error("Error attempting to read image.");
    });
    vi.mocked(createWorker).mockResolvedValue(w as never);
    await expect(ocrImage(Buffer.from("x"))).rejects.toThrow("read image");
    await expect(ocrImage(Buffer.from("x"))).rejects.toThrow("read image");
    expect(createWorker).toHaveBeenCalledTimes(1);
    expect(w.terminate).not.toHaveBeenCalled();
  });

  it("throws away a worker that timed out", async () => {
    const stuck = fakeWorker(() => new Promise(() => {}));
    const fresh = fakeWorker(async () => ({ data: page }));
    vi.mocked(createWorker).mockResolvedValueOnce(stuck as never).mockResolvedValueOnce(fresh as never);
    const call = ocrImage(Buffer.from("x"));
    const failed = expect(call).rejects.toThrow("ocr timed out");
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(stuck.terminate).toHaveBeenCalled();
    expect((await ocrImage(Buffer.from("x"))).confidence).toBe(91);
    expect(createWorker).toHaveBeenCalledTimes(2);
  });

  it("an old timeout doesn't kill the worker that replaced it", async () => {
    const stuck = fakeWorker(() => new Promise(() => {}));
    const fresh = fakeWorker(async () => ({ data: page }));
    vi.mocked(createWorker).mockResolvedValueOnce(stuck as never).mockResolvedValueOnce(fresh as never);
    const old = ocrImage(Buffer.from("x"));
    const failed = expect(old).rejects.toThrow("ocr timed out");
    await vi.advanceTimersByTimeAsync(0);
    await closeOcr();
    expect((await ocrImage(Buffer.from("x"))).confidence).toBe(91);
    await vi.advanceTimersByTimeAsync(30_000);
    await failed;
    expect(fresh.terminate).not.toHaveBeenCalled();
    await ocrImage(Buffer.from("x"));
    expect(createWorker).toHaveBeenCalledTimes(2);
  });
});
