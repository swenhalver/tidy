import { thumbnailBatchLimit, decodeThumbnailParts } from "@/lib/design/thumbnail-batch";

import { downloadThumbnail } from "./thumbnail-queue";

type Pending = {
  url: URL;
  uid: string;
  signal: AbortSignal;
  priority: () => number;
  resolve: (response: Response) => void;
  reject: (error: unknown) => void;
};
let pending: Pending[] = [];
let scheduled = false;

export function fetchThumbnail(
  url: string,
  signal: AbortSignal,
  priority: () => number,
): Promise<Response> {
  const parsed = new URL(url, typeof location === "undefined" ? undefined : location.href);
  const match = /^\/api\/files\/([^/]+)\/thumbnail$/.exec(parsed.pathname);
  if (
    !match ||
    parsed.searchParams.has("width") ||
    (typeof location !== "undefined" && parsed.origin !== location.origin)
  )
    return downloadThumbnail(() => original(url, signal), signal, priority);
  signal.throwIfAborted();
  return new Promise<Response>((resolve, reject) => {
    pending.push({
      url: parsed,
      uid: decodeURIComponent(match[1]!),
      signal,
      priority,
      resolve,
      reject,
    });
    if (!scheduled) {
      scheduled = true;
      queueMicrotask(flush);
    }
  });
}

function flush() {
  scheduled = false;
  const waiting = pending;
  pending = [];
  while (waiting.length) {
    const first = waiting.shift()!;
    const group = [first];
    for (let index = 0; index < waiting.length && group.length < thumbnailBatchLimit;) {
      if (waiting[index]!.url.origin === first.url.origin) group.push(waiting.splice(index, 1)[0]!);
      else index++;
    }
    void dispatch(group).catch((error: unknown) => group.forEach((item) => item.reject(error)));
  }
}

async function dispatch(group: Pending[]) {
  const live = group.filter((item) => {
    if (!item.signal.aborted) return true;
    item.reject(item.signal.reason);
    return false;
  });
  if (!live.length) return;
  if (live.length === 1) {
    const item = live[0]!;
    item.resolve(
      await downloadThumbnail(() => original(item.url, item.signal), item.signal, item.priority),
    );
    return;
  }
  const controller = new AbortController();
  const unfinished = new Set(live);
  const aborted = () => {
    if (unfinished.size && [...unfinished].every((item) => item.signal.aborted)) controller.abort();
  };
  live.forEach((item) => item.signal.addEventListener("abort", aborted, { once: true }));
  try {
    await downloadThumbnail(
      async () => {
        const requested = live
          .filter((item) => {
            if (!item.signal.aborted) return true;
            item.reject(item.signal.reason);
            unfinished.delete(item);
            return false;
          })
          .sort((a, b) => b.priority() - a.priority());
        if (!requested.length) return;
        const response = await fetch(new URL("/api/files/thumbnails", requested[0]!.url), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            thumbnails: requested.map(({ uid, url }) => ({
              uid,
              version: url.searchParams.get("version"),
            })),
          }),
          signal: controller.signal,
        });
        if (response.status === 404 || response.status === 405) {
          let next = 0;
          await Promise.all(
            Array.from({ length: Math.min(4, requested.length) }, async () => {
              while (next < requested.length) {
                const item = requested[next++]!;
                item.resolve(await original(item.url, item.signal));
              }
            }),
          );
          return;
        }
        if (!response.ok) {
          requested.forEach((item) =>
            item.resolve(
              new Response(null, {
                status: response.status,
                headers: response.headers,
              }),
            ),
          );
          return;
        }
        const completed = new Set<number>();
        for await (const part of decodeThumbnailParts(response)) {
          const item = requested[part.index];
          if (!item || completed.has(part.index)) throw new Error("Invalid thumbnail batch index.");
          completed.add(part.index);
          unfinished.delete(item);
          const headers = new Headers();
          if (part.retryAfter !== null) headers.set("Retry-After", part.retryAfter);
          if (item.signal.aborted) item.reject(item.signal.reason);
          else
            item.resolve(
              new Response(
                part.status === 200 ? new Blob([part.bytes], { type: part.type }) : null,
                {
                  status: part.status,
                  headers,
                },
              ),
            );
          aborted();
        }
        if (completed.size !== requested.length)
          throw new Error("Thumbnail batch results are incomplete.");
      },
      controller.signal,
      () => Math.max(...live.map((item) => item.priority())),
      Math.min(4, live.length),
    );
  } finally {
    live.forEach((item) => item.signal.removeEventListener("abort", aborted));
  }
}

async function original(url: string | URL, signal: AbortSignal) {
  const response = await fetch(url, { signal });
  return response.ok
    ? new Response(await response.blob(), { status: response.status, headers: response.headers })
    : response;
}
