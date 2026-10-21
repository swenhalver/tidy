import { expect, test } from "bun:test";
import {
  blankDesignDocument,
  designNodeSchema,
  parseDesignDocument,
  parseImmutableDesignDocument,
} from "./document";
import type { VectorContour } from "@tidy/design/vector-geometry";
import { DESIGN_GEOMETRY_LIMITS, layerSizeLimit } from "@tidy/design/document-limits";
import { createPenPath } from "../../../../packages/editor/src/design/pen-path";
import { resizeBox } from "./resize-box";
import { proportionalImageSize } from "./image-sizing";

function path(contour?: VectorContour) {
  return createPenPath({
    id: "pen",
    pageId: "page-1",
    parentId: null,
    contour: contour ?? {
      id: "contour",
      closed: false,
      points: [
        { id: "a", x: -2000, y: -1000 },
        { id: "b", x: 6000, y: 2500 },
        { id: "c", x: 1000, y: 1000 },
      ],
    },
  });
}

for (const parse of [parseDesignDocument, parseImmutableDesignDocument]) {
  test(`${parse.name} accepts a large pen path without changing its geometry`, () => {
    const node = path();
    const document = blankDesignDocument();
    const result = parse({ ...document, nodes: [{ ...node, pageId: document.pages[0].id }] });
    expect(result.nodes[0].box).toEqual({ x: -2000, y: -1000, width: 8000, height: 3500 });
    expect(result.nodes[0].vectorPath?.d).toBe("M 0 0 L 8000 3500 L 3000 2000");
  });
}

test("curve handles can extend beyond the old limit even when anchors fit", () => {
  const node = path({
    id: "curve",
    closed: false,
    points: [
      { id: "a", x: 0, y: 0, out: { x: 6000, y: 0 } },
      { id: "b", x: 100, y: 100 },
    ],
  });
  const saved = designNodeSchema.parse(node);
  expect(saved.box).toEqual({ x: 0, y: 0, width: 6000, height: 100 });
  expect(saved.vectorPath?.d).toBe("M 0 0 C 6000 0 100 100 100 100");
});

test("large vector limits do not admit oversized raster, frame, text, or container layers", () => {
  const node = path();
  for (const type of ["image", "artboard", "text", "container", "vector"] as const) {
    expect(designNodeSchema.safeParse({ ...node, type, vectorPath: undefined }).success).toBe(
      false,
    );
  }
  expect(
    designNodeSchema.safeParse({
      ...node,
      box: { ...node.box, width: DESIGN_GEOMETRY_LIMITS.vectorSize + 1 },
    }).success,
  ).toBe(false);
});

test("immutable cache cannot reuse a large vector box on a non-vector layer", () => {
  const document = blankDesignDocument();
  const saved = parseImmutableDesignDocument({
    ...document,
    nodes: [{ ...path(), pageId: document.pages[0].id }],
  });
  expect(() =>
    parseImmutableDesignDocument({
      ...saved,
      nodes: [{ ...saved.nodes[0], type: "container", vectorPath: undefined }],
    }),
  ).toThrow();
});

test("large pen paths resize without clamping to the old limit", () => {
  const node = path();
  const maxSize = layerSizeLimit(node);
  const resized = resizeBox(node.box, "e", { x: 1000, y: 0 }, { maxSize });
  expect(resized.width).toBe(9000);
  expect(resized.x).toBe(node.box.x);
  const proportional = proportionalImageSize(node.box, "width", 16000, maxSize);
  expect(proportional).toEqual({ width: 16000, height: 7000 });
});
