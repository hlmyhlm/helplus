import path from "path";
import { mkdir } from "fs/promises";
import { createWorker, type Worker } from "tesseract.js";
import { logger } from "@/lib/logger";
import type { OcrResult } from "@/lib/privacy/ic-image";

let workerPromise: Promise<Worker> | null = null;
const TIMEOUT_MS = 30_000;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const cachePath = path.join(process.cwd(), ".cache", "tesseract");
      await mkdir(cachePath, { recursive: true });
      // without an errorHandler a failed job throws inside the message listener
      return createWorker("eng", undefined, { cachePath, errorHandler: (e) => logger.error("ocr worker error", e) });
    })();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

async function recognize(png: Buffer): Promise<OcrResult> {
  const worker = await getWorker();
  const { data } = await worker.recognize(png, {}, { blocks: true });
  const lines = (data.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.lines.map((l) => ({
        words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } })),
      }))
    )
  );
  return { confidence: data.confidence, lines };
}

export async function ocrImage(png: Buffer): Promise<OcrResult> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("ocr timed out")), TIMEOUT_MS);
  });
  try {
    return await Promise.race([recognize(png), timeout]);
  } catch (error) {
    // a stuck or broken worker would block every later call, so start fresh
    await closeOcr().catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export async function closeOcr(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  const worker = await pending.catch(() => null);
  await worker?.terminate();
}
