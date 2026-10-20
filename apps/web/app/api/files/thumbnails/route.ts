import { auth } from "@/lib/auth";
import { thumbnailBatchSchema } from "@/lib/design/thumbnail-batch";
import { thumbnailBatchResponseForUser } from "@/lib/design/thumbnail-batch-service";
import { boundedRequest, RequestBodyError, requestBodyError } from "@/lib/http/request-body";
import { imageFailureResponse } from "@/lib/design/image-budget";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (
    request.headers.get("origin") !==
    new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin
  )
    return new Response(null, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401 });
  let input: unknown;
  try {
    input = await (await boundedRequest(request, 16_384)).json();
  } catch (error) {
    if (error instanceof RequestBodyError) return requestBodyError(error);
    return new Response(null, { status: 400 });
  }
  const batch = thumbnailBatchSchema.safeParse(input);
  if (!batch.success) return new Response(null, { status: 400 });
  try {
    return await thumbnailBatchResponseForUser(session.user.id, batch.data, request);
  } catch (error) {
    return imageFailureResponse(error);
  }
}
