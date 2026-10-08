// shared shape for attachments returned over http, routes can't export this themselves
export interface AttachmentRow {
  id: string;
  messageId: string | null;
  fileName: string;
  status: string;
  icCount: number;
  width: number;
  height: number;
  checkNote: string;
  originalDeletedAt: Date | null;
  createdAt: Date;
}

export function toRow(a: {
  id: string;
  messageId: string | null;
  fileName: string;
  status: string;
  icCount: number;
  width: number;
  height: number;
  checkNote: string;
  originalDeletedAt: Date | null;
  createdAt: Date;
}): AttachmentRow {
  const { id, messageId, fileName, status, icCount, width, height, checkNote, originalDeletedAt, createdAt } = a;
  return { id, messageId, fileName, status, icCount, width, height, checkNote, originalDeletedAt, createdAt };
}
