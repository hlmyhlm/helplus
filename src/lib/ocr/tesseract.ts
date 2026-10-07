import path from "path";
import { mkdir } from "fs/promises";
import { createWorker, type Worker } from "tesseract.js";
import { logger } from "@/lib/logger";
import type { OcrResult } from "@/lib/privacy/ic-image";

let workerPromise: Promise<Worker> | null = null;
// jobs run one after another, so each timeout only counts its own run
let queue: Promise<unknown> = Promise.resolve();
const TIMEOUT_MS = 30_000;

class OcrTimeout extends Error {
  constructor() {
    super("ocr timed out");
  }
}

function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    const created = (async () => {
      const cachePath = path.join(process.cwd(), ".cache", "tesseract");
      await mkdir(cachePath, { recursive: true });
      // without an errorHandler a failed job throws inside the message listener
      return createWorker("eng", undefined, { cachePath, errorHandler: (e) => logger.error("ocr worker error", e) });
    })();
    created.catch(() => {
      if (workerPromise === created) workerPromise = null;
    });
    workerPromise = created;
  }
  return workerPromise;
}

async function recognize(current: Promise<Worker>, png: Buffer): Promise<OcrResult> {
  const { data } = await (await current).recognize(png, {}, { blocks: true });
  const lines = (data.blocks ?? []).flatMap((b) =>
    b.paragraphs.flatMap((p) =>
      p.lines.map((l) => ({
        words: l.words.map((w) => ({ text: w.text, confidence: w.confidence, bbox: { x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 } })),
      }))
    )
  );
  return { confidence: data.confidence, lines };
}

export function ocrImage(png: Buffer): Promise<OcrResult> {
  const job = queue.then(() => runJob(png));
  queue = job.catch(() => {});
  return job;
}

async function runJob(png: Buffer): Promise<OcrResult> {
  const current = getWorker();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new OcrTimeout()), TIMEOUT_MS);
  });
  try {
    return await Promise.race([recognize(current, png), timeout]);
  } catch (error) {
    // a stuck worker blocks every later call, but a bad image doesn't hurt it
    if (error instanceof OcrTimeout && workerPromise === current) await closeOcr().catch(() => {});
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
