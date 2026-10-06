import path from "path";
import { localStore } from "./local";

export interface FileStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
  removeFolder(prefix: string): Promise<void>;
}

// local disk for now, an s3/minio store comes with deployment
export function fileStore(): FileStore {
  return localStore(process.env.HELPLUS_STORAGE_DIR || path.join(process.cwd(), "storage"));
}

export function attachmentFolder(companyId: string, id: string): string {
  return `c/${companyId}/attachments/${id}`;
}

// each masked render gets its own file so a slow run can't overwrite a newer one
export function attachmentKey(companyId: string, id: string, kind: "original" | "masked", renderId?: string): string {
  const file = kind === "original" ? "original.bin" : renderId ? `masked-${renderId}.png` : "masked.png";
  return `${attachmentFolder(companyId, id)}/${file}`;
}
