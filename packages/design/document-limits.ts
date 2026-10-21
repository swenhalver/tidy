import type { RefinementCtx } from "zod";

/** Resource ceilings shared by browser schemas and authenticated publication. */
export const DESIGN_DOCUMENT_LIMITS = { nodes: 10_000, bytes: 10_000_000 } as const;

export const DESIGN_GEOMETRY_LIMITS = { layerSize: 5000, vectorSize: 100000 } as const;

export function layerSizeLimit(node: { type: string; vectorPath?: unknown }): number {
  return node.type === "vector" && node.vectorPath
    ? DESIGN_GEOMETRY_LIMITS.vectorSize
    : DESIGN_GEOMETRY_LIMITS.layerSize;
}

export function checkLayerSize(
  node: { type: string; vectorPath?: unknown; box: { width: number; height: number } },
  ctx: RefinementCtx,
) {
  const maximum = layerSizeLimit(node);
  for (const axis of ["width", "height"] as const) {
    if (node.box[axis] > maximum)
      ctx.addIssue({
        code: "custom",
        path: ["box", axis],
        message: `Layer ${axis} must not exceed ${maximum}.`,
      });
  }
}
