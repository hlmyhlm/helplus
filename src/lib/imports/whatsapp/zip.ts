import { unzipSync } from "fflate";

const MAX_ENTRIES = 5000;
const MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const IMAGE = /\.(jpe?g|png|webp)$/i;
const NOT_EXPORT = "This isn't a WhatsApp export";

class TooLarge extends Error {}

const baseName = (name: string) => name.split(/[/\\]/).pop() ?? "";

export function readExport(
  data: Buffer,
  fileName: string
): { chat: string; files: Map<string, Buffer>; skippedFiles: number } {
  // trust the PK bytes over the name, a .zip name without them is a broken zip
  const isZip = data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b;
  if (!isZip && !/\.zip$/i.test(fileName)) {
    return { chat: data.toString("utf8"), files: new Map(), skippedFiles: 0 };
  }

  let entries = 0;
  let total = 0;
  let skippedFiles = 0;
  let chatName: string | null = null;
  let unzipped;
  try {
    // the filter sees each entry before it's inflated, so limits hold before memory is spent
    unzipped = unzipSync(data, {
      filter: (f) => {
        if (f.name.endsWith("/")) return false;
        entries++;
        total += f.originalSize;
        if (entries > MAX_ENTRIES || total > MAX_TOTAL_BYTES) throw new TooLarge("This export is too large");
        const name = baseName(f.name);
        if (!chatName && /\.txt$/i.test(name) && /chat/i.test(name)) {
          chatName = f.name;
          return true;
        }
        if (IMAGE.test(name) && f.originalSize <= MAX_IMAGE_BYTES) return true;
        skippedFiles++;
        return false;
      },
    });
  } catch (error) {
    if (error instanceof TooLarge) throw error;
    throw new Error(NOT_EXPORT);
  }
  if (!chatName || !unzipped[chatName]) throw new Error(NOT_EXPORT);

  const files = new Map<string, Buffer>();
  for (const [name, bytes] of Object.entries(unzipped)) {
    if (name === chatName) continue;
    files.set(baseName(name), Buffer.from(bytes));
  }
  return { chat: Buffer.from(unzipped[chatName]).toString("utf8"), files, skippedFiles };
}
