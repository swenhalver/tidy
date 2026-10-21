import type { DesignNode } from "./document";
import {
  serializeContours,
  type VectorContour,
  type VectorPoint,
} from "@tidy/design/vector-geometry";

export function createPenPath({
  id,
  contour,
  parentId,
  pageId,
}: {
  id: string;
  contour: VectorContour;
  parentId: string | null;
  pageId: string;
}): DesignNode {
  if (contour.points.length < 2) throw new Error("Add at least two points to finish a path.");
  const all = contour.points.flatMap((p) => [
    p,
    ...(p.in ? [p.in] : []),
    ...(p.out ? [p.out] : []),
  ]);
  const x = Math.min(...all.map((p) => p.x)),
    y = Math.min(...all.map((p) => p.y));
  const width = Math.max(1, Math.max(...all.map((p) => p.x)) - x),
    height = Math.max(1, Math.max(...all.map((p) => p.y)) - y);
  const shift = (p: VectorPoint) => ({ x: p.x - x, y: p.y - y });
  const contours = [
    {
      ...contour,
      points: contour.points.map((p) => ({
        ...p,
        ...shift(p),
        in: p.in ? shift(p.in) : undefined,
        out: p.out ? shift(p.out) : undefined,
      })),
    },
  ];

  return {
    id,
    parentId,
    pageId,
    name: "Path",
    type: "vector",
    box: { x, y, width, height },
    vectorPath: {
      d: serializeContours(contours),
      contours,
      viewBox: { x: 0, y: 0, width, height },
      fillRule: "nonzero",
    },
    style: {
      paints: [],
      strokePaints: [
        { id: crypto.randomUUID(), type: "solid", color: "#111111", opacity: 1, visible: true },
      ],
      borderWidth: 2,
      strokeCap: "round",
      strokeJoin: "round",
    },
    layout: "absolute",
    positionMode: parentId ? "absolute" : undefined,
    visible: true,
    locked: false,
  };
}
