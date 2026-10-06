import path from "path";
import { localStore } from "./local";

export interface FileStore {
  put(key: string, data: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

// local disk for now, an s3/minio store comes with deployment
export function fileStore(): FileStore {
  return localStore(process.env.HELPLUS_STORAGE_DIR || path.join(process.cwd(), "storage"));
}

export function attachmentKey(companyId: string, id: string, kind: "original" | "masked"): string {
  return `c/${companyId}/attachments/${id}/${kind === "original" ? "original.bin" : "masked.png"}`;
}
