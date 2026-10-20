import { z } from "zod";
import { IMAGE_READ_LIMITS } from "@/lib/security/resource-limits";

export const thumbnailBatchLimit = 12;
export const thumbnailBatchSchema = z.object({
  thumbnails: z
    .array(
      z.object({
        uid: z.string().min(1).max(120),
        version: z.string().max(512).nullable(),
      }),
    )
    .min(1)
    .max(thumbnailBatchLimit),
});
export type ThumbnailBatch = z.infer<typeof thumbnailBatchSchema>;
const partSchema = z.object({
  index: z
    .number()
    .int()
    .min(0)
    .max(thumbnailBatchLimit - 1),
  status: z.number().int().min(200).max(599),
  retryAfter: z.string().max(128).nullable(),
  type: z.string().max(100),
  size: z.number().int().min(0).max(IMAGE_READ_LIMITS.bytes),
});
type Part = z.infer<typeof partSchema>;

/** Frames contain a big-endian 4-byte JSON-header length, the header, then original bytes. */
export function encodeThumbnailPart(part: Omit<Part, "size">, bytes: Uint8Array) {
  const header = new TextEncoder().encode(JSON.stringify({ ...part, size: bytes.byteLength }));
  const result = new Uint8Array(4 + header.byteLength + bytes.byteLength);
  new DataView(result.buffer).setUint32(0, header.byteLength);
  result.set(header, 4);
  result.set(bytes, 4 + header.byteLength);
  return result;
}

export async function* decodeThumbnailParts(response: Response) {
  if (!response.body) throw new Error("Thumbnail batch body is unavailable.");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let available = 0,
    offset = 0,
    received = 0;
  const take = async (length: number, allowEnd = false) => {
    while (available < length) {
      const next = await reader.read();
      if (next.done) {
        if (allowEnd && available === 0) return null;
        throw new Error("Thumbnail batch is incomplete.");
      }
      received += next.value.byteLength;
      if (received > thumbnailBatchLimit * (IMAGE_READ_LIMITS.bytes + 1028))
        throw new Error("Thumbnail batch exceeds its byte limit.");
      chunks.push(next.value);
      available += next.value.byteLength;
    }
    const result = new Uint8Array(length);
    let written = 0;
    while (written < length) {
      const first = chunks[0]!;
      const count = Math.min(first.byteLength - offset, length - written);
      result.set(first.subarray(offset, offset + count), written);
      written += count;
      offset += count;
      available -= count;
      if (offset === first.byteLength) {
        chunks.shift();
        offset = 0;
      }
    }
    return result;
  };
  try {
    for (;;) {
      const prefix = await take(4, true);
      if (!prefix) break;
      const length = new DataView(prefix.buffer).getUint32(0);
      if (length < 1 || length > 1024) throw new Error("Invalid thumbnail batch header.");
      const header = await take(length);
      if (!header) throw new Error("Thumbnail batch header is unavailable.");
      const part = partSchema.parse(JSON.parse(new TextDecoder().decode(header)));
      const bytes = await take(part.size);
      if (!bytes) throw new Error("Thumbnail batch bytes are unavailable.");
      yield { ...part, bytes };
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
