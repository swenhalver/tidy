import { z } from "zod";

/** Upstream release notices. This fork never downloads or installs updates itself. */
export const appUpdateStateSchema = z.object({
  status: z.enum(["unsupported", "idle", "available"]),
  version: z.string().max(40).optional(),
  tag: z.string().max(60).optional(),
  commits: z.number().int().min(0).optional(),
});
export type AppUpdateState = z.infer<typeof appUpdateStateSchema>;
