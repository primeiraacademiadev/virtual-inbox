import { randomUUID } from "node:crypto";
import type { Attachment } from "../core.js";

export type MimeAttachmentInput = {
  filename?: string | null;
  mimeType?: string | null;
  content: string | ArrayBuffer | ArrayBufferView;
};

/** Convert postal-mime attachment payloads to owned Buffers before quotas or storage. */
export function attachmentBytes(content: MimeAttachmentInput["content"]): Buffer {
  if (typeof content === "string") return Buffer.from(content, "base64");
  if (content instanceof ArrayBuffer) return Buffer.from(new Uint8Array(content));
  return Buffer.from(new Uint8Array(content.buffer, content.byteOffset, content.byteLength));
}
export function normalizeMimeAttachments(items: readonly MimeAttachmentInput[]): Attachment[] {
  return items.map((item) => {
    const bytes = attachmentBytes(item.content);
    return {
      id: randomUUID(),
      filename: item.filename || "attachment",
      contentType: item.mimeType || "application/octet-stream",
      size: bytes.byteLength,
      content: bytes,
    };
  });
}
export function sanitizeDownloadName(name: string): string {
  return name.replace(/[\r\n]/g, "").replace(/[\\/]/g, "_");
}
