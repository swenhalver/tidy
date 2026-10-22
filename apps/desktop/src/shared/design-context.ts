import { z } from "zod";

export const designContextSchema = z
  .object({
    fileId: z.string().uuid(),
    pageId: z.string().min(1).max(120),
    nodeIds: z.array(z.string().min(1).max(120)).max(100),
    version: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
export type DesignContext = z.infer<typeof designContextSchema>;
