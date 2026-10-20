import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { encodeThumbnailPart, type ThumbnailBatch } from "./thumbnail-batch";
import { thumbnailResponseForUser } from "./thumbnail-service";
import { db } from "@/lib/db";
import { VIEW_ROLES_SQL } from "@/lib/organizations/roles";
import { runWithRequestSignal } from "@/lib/request-lifecycle";

export async function thumbnailBatchResponseForUser(
  userId: string,
  batch: ThumbnailBatch,
  request: Request,
) {
  const controller = new AbortController();
  const signal = AbortSignal.any([request.signal, controller.signal, AbortSignal.timeout(20_000)]);
  return runWithRequestSignal(signal, async () => {
    const discovered = await db.query<{
      uid: string;
      version: string | null;
      organizationId: string;
    }>(
      `select requested.uid, requested.version, f."organizationId"
      from jsonb_to_recordset($1::jsonb) as requested(uid text, version text)
      join "designFile" f on f."id"=requested.uid
      join "designFileThumbnail" t on t."fileId"=f."id" and (requested.version is null or t."version"=requested.version)
      join "member" m on m."organizationId"=f."organizationId" and m."userId"=$2 and m."role" in ${VIEW_ROLES_SQL}
      join "user" u on u."id"=m."userId" and u."emailVerified"=true`,
      [JSON.stringify(batch.thumbnails), userId],
    );
    const inRequest = AsyncLocalStorage.snapshot();
    const read = (item: ThumbnailBatch["thumbnails"][number], index: number) =>
      inRequest(async () => {
        const { uid, version } = item;
        const url = new URL(`/api/files/${encodeURIComponent(uid)}/thumbnail`, request.url);
        if (version !== null) url.searchParams.set("version", version);
        const response = await thumbnailResponseForUser(
          userId,
          uid,
          new Request(url, { signal }),
          discovered.rows.find((row) => row.uid === uid && row.version === version)
            ?.organizationId ?? null,
        );
        const bytes = response.ok ? new Uint8Array(await response.arrayBuffer()) : new Uint8Array();
        return {
          index,
          frame: encodeThumbnailPart(
            {
              index,
              status: response.status,
              retryAfter: response.headers.get("Retry-After"),
              type: response.headers.get("Content-Type") ?? "",
            },
            bytes,
          ),
        };
      });
    const pending = new Map<number, ReturnType<typeof read>>();
    let next = 0;
    const fill = () => {
      while (pending.size < 4 && next < batch.thumbnails.length) {
        const index = next++;
        pending.set(index, read(batch.thumbnails[index]!, index));
      }
    };
    const body = new ReadableStream<Uint8Array>({
      async pull(destination) {
        try {
          signal.throwIfAborted();
          fill();
          const part = await Promise.race(pending.values());
          pending.delete(part.index);
          fill();
          signal.throwIfAborted();
          destination.enqueue(part.frame);
          if (!pending.size) destination.close();
        } catch (error) {
          controller.abort(error);
          await Promise.allSettled(pending.values());
          destination.error(error);
        }
      },
      async cancel(reason) {
        controller.abort(reason);
        await Promise.allSettled(pending.values());
      },
    });
    return new Response(body, {
      headers: { "Cache-Control": "private, no-store", "Content-Type": "application/octet-stream" },
    });
  });
}
