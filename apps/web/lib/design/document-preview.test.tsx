import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { blankDesignDocument, type DesignNode } from "@tidy/design/document";
import { DocumentPreview } from "@tidy/editor/components/files/document-preview";

test("a thread preview shows its selected page and containing frame, with a usable fallback for removed selections", () => {
  const document = blankDesignDocument();
  const firstPage = document.pages![0].id;
  document.pages!.push({ id: "second", name: "Second" });
  const frame = (id: string, pageId: string): DesignNode => ({
    id,
    parentId: null,
    pageId,
    type: "artboard",
    name: id,
    visible: true,
    locked: false,
    box: { x: 0, y: 0, width: 800, height: 600 },
    layout: "absolute",
    style: { fill: "#ffffff" },
  });
  document.nodes = [
    frame("first-frame", firstPage),
    frame("selected-frame", "second"),
    frame("other-frame", "second"),
    { ...frame("child", "second"), parentId: "selected-frame", type: "container" },
  ];
  const render = (pageId: string, nodeIds: string[]) =>
    renderToStaticMarkup(createElement(DocumentPreview, { content: document, pageId, nodeIds }));
  const selected = render("second", ["child"]);
  expect(selected).toContain('data-thumbnail-node="selected-frame"');
  expect(selected).toContain('data-thumbnail-node="child"');
  expect(selected).not.toContain('data-thumbnail-node="first-frame"');
  expect(selected).not.toContain('data-thumbnail-node="other-frame"');
  expect(render("second", ["removed"])).toContain('data-thumbnail-node="other-frame"');
  expect(render("removed-page", [])).toContain('data-thumbnail-node="first-frame"');
  document.nodes[1].visible = false;
  for (const selection of [["selected-frame"], ["child"]]) {
    const fallback = render("second", selection);
    expect(fallback).toContain('data-thumbnail-node="other-frame"');
    expect(fallback).not.toContain('data-thumbnail-node="selected-frame"');
    expect(fallback).not.toContain('data-thumbnail-node="first-frame"');
  }
});
