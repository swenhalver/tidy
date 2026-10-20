import { expect, test } from "bun:test";
import { decodeThumbnailParts, encodeThumbnailPart } from "./thumbnail-batch";

const metadata = { index: 0, status: 200, retryAfter: null, type: "image/png" };

test("thumbnail frames preserve original bytes across arbitrary network chunks", async () => {
  const bytes = new Uint8Array([0, 1, 128, 255, 13, 10]);
  const frame = encodeThumbnailPart(metadata, bytes);
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const byte of frame) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    }),
  );
  const parts = await Array.fromAsync(decodeThumbnailParts(response));
  expect(parts).toHaveLength(1);
  expect(parts[0]).toEqual({ ...metadata, size: bytes.length, bytes });
});
