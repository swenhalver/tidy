import * as z from "zod";
import { DESIGN_GEOMETRY_LIMITS } from "./document-limits";
import { serializeContours } from "./vector-geometry";

const coordinate = z.number().finite().min(-100000).max(100000);
const point = z.object({ x: coordinate, y: coordinate }).strict();
const anchor = point.extend({
  id: z.string().min(1).max(120),
  in: point.optional(),
  out: point.optional(),
  mode: z.enum(["corner", "smooth", "symmetric"]).optional(),
});
export const vectorPathSchema = z
  .object({
    d: z
      .string()
      .min(1)
      .max(150000)
      .regex(/^[MmLlHhVvCcSsQqTtAaZzEe0-9+.,\s-]+$/)
      .refine(
        (d) =>
          /^[Mm]/.test(d.trim()) &&
          [...d.matchAll(/[+-]?(?:\d*\.)?\d+(?:[eE][+-]?\d+)?/g)].every(
            ([n]) => Number.isFinite(Number(n)) && Math.abs(Number(n)) <= 100000,
          ),
        "Path coordinates must be finite and bounded.",
      ),
    viewBox: point.extend({
      width: z.number().finite().min(1).max(DESIGN_GEOMETRY_LIMITS.vectorSize),
      height: z.number().finite().min(1).max(DESIGN_GEOMETRY_LIMITS.vectorSize),
    }),
    fillRule: z.enum(["nonzero", "evenodd"]).default("nonzero"),
    shape: z
      .object({
        kind: z.enum(["ellipse", "line", "arrow", "polygon", "star"]),
        points: z.number().int().min(3).max(64).optional(),
        innerRadius: z.number().min(0.01).max(1).optional(),
        reverseX: z.boolean().optional(),
        reverseY: z.boolean().optional(),
      })
      .strict()
      .optional(),
    contours: z
      .array(
        z
          .object({
            id: z.string().min(1).max(120),
            closed: z.boolean(),
            points: z.array(anchor).min(1).max(1000),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .optional(),
  })
  .strict()
  .superRefine((path, ctx) => {
    if (!path.contours) return;
    if (path.contours.reduce((count, contour) => count + contour.points.length, 0) > 1000) {
      ctx.addIssue({ code: "custom", message: "Paths need at most 1,000 points." });
      return;
    }
    const points = path.contours.flatMap((c) =>
      c.points.flatMap((p) => [p, ...(p.in ? [p.in] : []), ...(p.out ? [p.out] : [])]),
    );
    const extentWidth =
      Math.max(path.viewBox.x + path.viewBox.width, ...points.map((p) => p.x)) -
      Math.min(path.viewBox.x, ...points.map((p) => p.x));
    const extentHeight =
      Math.max(path.viewBox.y + path.viewBox.height, ...points.map((p) => p.y)) -
      Math.min(path.viewBox.y, ...points.map((p) => p.y));
    if (
      extentWidth > DESIGN_GEOMETRY_LIMITS.vectorSize ||
      extentHeight > DESIGN_GEOMETRY_LIMITS.vectorSize
    )
      ctx.addIssue({
        code: "custom",
        message: `Editable path extents must fit within ${DESIGN_GEOMETRY_LIMITS.vectorSize} SVG units.`,
      });
    const ids = path.contours.flatMap((c) => c.points.map((p) => p.id));
    if (
      new Set(ids).size !== ids.length ||
      new Set(path.contours.map((c) => c.id)).size !== path.contours.length
    )
      ctx.addIssue({
        code: "custom",
        message: "Paths need unique contour/point IDs.",
      });
    if (serializeContours(path.contours) !== path.d)
      ctx.addIssue({ code: "custom", message: "Path data must match its editable contours." });
  });
