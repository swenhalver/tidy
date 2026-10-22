import { z } from "zod";

/** App previews are explicit local development destinations, never Tidy resources or file URLs. */
export function localPreviewURL(value: string): string {
  if (value.includes("\\")) throw new Error("Enter a localhost URL without backslashes.");
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password
  )
    throw new Error("Enter an HTTP or HTTPS localhost URL for your running app.");
  return url.href;
}

const url = z
  .string()
  .max(2048)
  .transform((value, context) => {
    try {
      return localPreviewURL(value);
    } catch {
      context.addIssue({ code: "custom", message: "Enter a localhost app URL." });
      return z.NEVER;
    }
  });
export const appPreviewSchema = z.discriminatedUnion("visible", [
  z.object({ visible: z.literal(false) }).strict(),
  z
    .object({
      visible: z.literal(true),
      url,
      bounds: z
        .object({
          x: z.number().int().min(0).max(20_000),
          y: z.number().int().min(0).max(20_000),
          width: z.number().int().min(1).max(20_000),
          height: z.number().int().min(1).max(20_000),
        })
        .strict(),
      reload: z.boolean().optional(),
    })
    .strict(),
]);
export type AppPreviewRequest = z.infer<typeof appPreviewSchema>;
