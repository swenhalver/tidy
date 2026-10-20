import { downloadThumbnail } from "./thumbnail-queue";
import { fetchThumbnail } from "./thumbnail-batch-download";

type ThumbnailDownload =
  | { kind: "ready"; blob: Blob }
  | { kind: "missing" }
  | { kind: "denied" }
  | { kind: "retry"; afterMs: number };

export function thumbnailRetryDelay(value: string | null) {
  if (value === null || !value.trim()) return 10_000;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - Date.now();
  return Number.isFinite(milliseconds)
    ? Math.min(2_147_483_647, Math.max(1000, milliseconds))
    : 10_000;
}

export function readThumbnail({
  url,
  signal,
  priority,
}: {
  url: string;
  signal: AbortSignal;
  priority: () => number;
}): Promise<ThumbnailDownload> {
  return fetchThumbnail(url, signal, priority).then(async (response) => {
    if (response.ok) return { kind: "ready", blob: await response.blob() };
    if (response.status === 404 || response.status === 410) return { kind: "missing" };
    if (response.status === 401 || response.status === 403) return { kind: "denied" };
    return { kind: "retry", afterMs: thumbnailRetryDelay(response.headers.get("Retry-After")) };
  });
}

export function trackThumbnailImage({
  image,
  signal,
  priority,
}: {
  image: HTMLImageElement;
  signal: AbortSignal;
  priority: () => number;
}) {
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(30_000)]);
  return downloadThumbnail(
    () =>
      new Promise<void>((resolve) => {
        const complete = () => {
          image.removeEventListener("load", complete);
          image.removeEventListener("error", complete);
          deadline.removeEventListener("abort", complete);
          resolve();
        };
        image.addEventListener("load", complete);
        image.addEventListener("error", complete);
        deadline.addEventListener("abort", complete, { once: true });
        if (image.complete || deadline.aborted) complete();
      }),
    deadline,
    priority,
  );
}
