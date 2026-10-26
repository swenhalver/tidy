/**
 * Local replacement for apps/web/lib/design/document-service.ts. The web module
 * stores documents in Postgres behind organization membership; this one reads
 * and writes the desktop app's `.tidy` project files. Document logic (merging,
 * patching, tokens, validation) is the web's own code, imported unchanged.
 */
import { randomUUID } from "node:crypto";
import {
  buildDrawnNode,
  documentAssetIds,
  parseDesignDocument,
  type DesignDocument,
  type DesignNode,
  type DesignNodeChanges,
} from "@/lib/design/document";
import type { DesignTokens } from "@/lib/design/design-tokens";
import { mergeDesignTokens } from "@/lib/design/token-catalog";
import { changedLayerBatch, trackDocumentChanges } from "@/lib/design/edit-document";
import { layoutReport } from "@/lib/design/layout-diagnostics";
import { sanitizeSvgAsset } from "@/lib/design/svg-asset";
import { mergeImport, requireImportSource } from "@/lib/design/merge-import";
import type { ExportAsset } from "@/lib/design/code-export";
import { summarizeImportChunks } from "@/lib/mcp/activity-summary";
import { PublicActionError } from "@/lib/security/public-error";
import { DESIGN_READ_LIMITS, IMPORT_LIMITS } from "@/lib/security/resource-limits";
import { cleanDesignName, validDesignFrame, validDesignRectangle } from "./service";
import type { FrameInput, RectangleInput } from "./service";
import { local } from "../local/context";
import type { LocalProject } from "../local/projects";
import type { StoredDesign } from "../local/store";

type Chunk = {
  nodes: unknown[];
  source?: unknown;
  warnings?: unknown[];
  tokens?: unknown;
  designTokens?: unknown;
  pages?: DesignDocument["pages"];
};
type Staging = {
  id: string;
  project: LocalProject;
  fileId: string | null;
  name: string;
  expectedRevision: number | null;
  chunks: Record<string, Chunk>;
  status: "staging" | "committed" | "aborted";
  committedRevision: number | null;
  expiresAt: number;
};

const IMPORT_TTL_MS = 24 * 60 * 60 * 1000;
const imports = new Map<string, Staging>();

async function withAssetMimeTypes(design: StoredDesign) {
  const ids = documentAssetIds(design.document);
  const types: Record<string, string> = {};
  for (const id of ids) {
    const asset = await local.readAsset(design.project, id).catch(() => null);
    if (asset) types[id] = asset.mimeType;
  }
  return {
    revision: design.revision,
    content: ids.length ? { ...design.document, assetMimeTypes: types } : design.document,
  };
}

async function verifyAssets(project: LocalProject, document: DesignDocument) {
  for (const id of documentAssetIds(document))
    if (!(await local.readAsset(project, id).catch(() => null)))
      throw new PublicActionError("One or more assets are missing or inaccessible.");
}

export async function documentSchemaReady() {
  return true;
}

export async function getDocument(_userId: string, fileId: string) {
  const design = await local.findDesign(fileId);
  return design ? withAssetMimeTypes(design) : null;
}

export async function getDocumentRevision(_userId: string, fileId: string) {
  const design = await local.findDesign(fileId);
  return design ? { revision: design.revision } : null;
}

/** Local documents have no legacy frame tables, so every file is already editable. */
export async function ensureEditorDocument(_userId: string, fileId: string) {
  const design = await local.findDesign(fileId);
  if (!design) throw new PublicActionError("File not found or access denied.");
  return withAssetMimeTypes(design);
}

export async function getDocumentPage(
  _userId: string,
  fileId: string,
  offset: number,
  limit: number,
) {
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 250
  )
    throw new PublicActionError("Invalid document page.");
  const design = await local.findDesign(fileId);
  if (!design) return null;
  const { nodes, ...metadata } = design.document;
  return {
    revision: design.revision,
    schemaVersion: metadata.schemaVersion,
    source: metadata.source,
    tokens: metadata.tokens ?? {},
    designTokens: metadata.designTokens ?? {},
    warnings: metadata.warnings,
    editedNodeIds: metadata.editedNodeIds,
    deletedSourceKeys: metadata.deletedSourceKeys ?? [],
    nodes: nodes.slice(offset, offset + limit),
    offset,
    totalNodes: nodes.length,
    nextOffset: offset + limit < nodes.length ? offset + limit : null,
  };
}

export async function getExportAssets(_userId: string, assetIds: string[]): Promise<ExportAsset[]> {
  if (!assetIds.length) return [];
  if (assetIds.length > DESIGN_READ_LIMITS.assetsPerExport)
    throw new PublicActionError("This export references too many assets.");
  let remaining = DESIGN_READ_LIMITS.exportBytes;
  const assets: ExportAsset[] = [];
  for (const id of new Set(assetIds)) {
    const asset = await local.findAsset(id);
    if (!asset) throw new PublicActionError("One or more assets are missing or inaccessible.");
    remaining -= Math.ceil((asset.base64.length * 3) / 4);
    if (remaining < 0) throw new PublicActionError("Export assets exceed 12 MB.");
    assets.push(asset);
  }
  return assets;
}

export async function appendBasicNodes(
  _userId: string,
  fileId: string,
  kind: "frame" | "rectangle",
  boxes: (FrameInput | RectangleInput)[],
) {
  if (
    boxes.length < 1 ||
    boxes.length > 50 ||
    boxes.some((box) => !(kind === "frame" ? validDesignFrame(box) : validDesignRectangle(box)))
  )
    throw new PublicActionError("Provide 1–50 valid shapes.");
  const design = await local.findDesign(fileId);
  if (!design) throw new PublicActionError("File not found or access denied.");
  let added: (DesignNode & { pageId: string })[] = [];
  await local.updateDesign(design, null, (current) => {
    added = boxes.map((box) => ({
      ...buildDrawnNode(randomUUID(), kind === "frame" ? "artboard" : "container", null, box),
      pageId: current.document.pages?.[0].id ?? "page-1",
    }));
    return {
      document: parseDesignDocument({
        ...current.document,
        nodes: [...current.document.nodes, ...added],
      }),
    };
  });
  return added.map((node) => ({ id: node.id, ...node.box }));
}

export async function createImport(
  _userId: string,
  organizationId: string,
  name: string,
  fileId?: string,
) {
  const cleanName = cleanDesignName(name);
  if (!cleanName) throw new PublicActionError("Enter a file name of up to 120 characters.");
  const project = await local.projects.resolve(organizationId);
  let expectedRevision: number | null = null;
  if (fileId) {
    const design = await local.findDesign(fileId);
    if (!design || design.project.path !== project.path)
      throw new PublicActionError("File not found or access denied.");
    expectedRevision = design.revision;
  }
  const now = Date.now();
  for (const [id, staged] of imports)
    if (staged.expiresAt <= now || staged.status === "aborted") imports.delete(id);
  const pending = [...imports.values()].filter(
    (staged) => staged.project.path === project.path && staged.status === "staging",
  );
  if (pending.length >= IMPORT_LIMITS.pendingPerUserPerOrganization)
    throw new PublicActionError(
      "Import allowance reached. Finish or abort a pending import, or wait for old imports to expire.",
    );
  const id = randomUUID();
  imports.set(id, {
    id,
    project,
    fileId: fileId ?? null,
    name: cleanName,
    expectedRevision,
    chunks: {},
    status: "staging",
    committedRevision: null,
    expiresAt: now + IMPORT_TTL_MS,
  });
  return {
    importId: id,
    fileId: fileId ?? null,
    expectedRevision,
    expiresInHours: 24,
    maxNodes: IMPORT_LIMITS.nodesPerImport,
    maxChunkNodes: 250,
  };
}

function loadImport(importId: string) {
  const staged = imports.get(importId);
  if (!staged || staged.expiresAt <= Date.now())
    throw new PublicActionError("Import not found or expired.");
  return staged;
}

function stage(staged: Staging, chunkId: string, chunk: Chunk) {
  if (staged.status !== "staging")
    throw new PublicActionError("Import unavailable, conflicting, or staging allowance exceeded.");
  const existing = staged.chunks[chunkId];
  if (existing && JSON.stringify(existing) !== JSON.stringify(chunk))
    throw new PublicActionError("Import unavailable, conflicting, or staging allowance exceeded.");
  const chunks = { ...staged.chunks, [chunkId]: chunk };
  const values = Object.values(chunks);
  if (
    values.length > IMPORT_LIMITS.chunksPerImport ||
    Buffer.byteLength(JSON.stringify(chunks)) > IMPORT_LIMITS.bytesPerImport ||
    values.reduce((total, value) => total + value.nodes.length, 0) > IMPORT_LIMITS.nodesPerImport
  )
    throw new PublicActionError("Import unavailable, conflicting, or staging allowance exceeded.");
  staged.chunks = chunks;
}

export async function putImportChunk(
  _userId: string,
  importId: string,
  chunkId: string,
  nodes: unknown[],
  source?: unknown,
  warnings?: unknown[],
  tokens?: unknown,
  designTokens?: unknown,
  pages?: DesignDocument["pages"],
) {
  const chunk = JSON.parse(
    JSON.stringify({ nodes, source, warnings, tokens, designTokens, pages }),
  ) as Chunk;
  if (
    !/^[a-zA-Z0-9_-]{1,40}$/.test(chunkId) ||
    nodes.length > 250 ||
    Buffer.byteLength(JSON.stringify(chunk), "utf8") > IMPORT_LIMITS.bytesPerChunk
  )
    throw new PublicActionError("Invalid or oversized import chunk.");
  const staged = loadImport(importId);
  stage(staged, chunkId, chunk);
  return {
    chunkId,
    chunkCount: Object.keys(staged.chunks).length,
    ...summarizeImportChunks(staged.chunks),
  };
}

export async function putImportDocument(_userId: string, importId: string, input: DesignDocument) {
  const document = parseDesignDocument(input);
  const staged = loadImport(importId);
  if (Object.keys(staged.chunks).length && !staged.chunks["0000"])
    throw new PublicActionError("Import is unavailable or already contains different data.");
  stage(staged, "0000", {
    nodes: document.nodes,
    source: document.source,
    warnings: document.warnings,
    tokens: document.tokens,
    designTokens: document.designTokens,
    pages: document.pages,
  });
}

function assemble(chunks: Staging["chunks"]): DesignDocument {
  const ordered = Object.entries(chunks)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, value]) => value);
  if (!ordered.length) throw new PublicActionError("Import has no chunks.");
  const source = ordered.find((chunk) => chunk.source)?.source as DesignDocument["source"];
  const tokens = Object.assign(
    {},
    ...ordered.map((chunk) => chunk.tokens ?? {}),
  ) as DesignDocument["tokens"];
  const importKey = source ? `${source.project}:${source.route}` : undefined;
  return parseDesignDocument({
    schemaVersion: 1,
    legacyConverted: true,
    nodes: ordered
      .flatMap((chunk) => chunk.nodes)
      .map((node) => ({ ...(node as object), importKey })),
    source,
    pages: ordered.find((chunk) => chunk.pages)?.pages,
    tokens,
    designTokens: Object.assign({}, ...ordered.map((chunk) => chunk.designTokens ?? {})),
    warnings: ordered.flatMap((chunk) => chunk.warnings ?? []),
  });
}

export async function validateImport(_userId: string, importId: string) {
  const staged = loadImport(importId);
  if (staged.status !== "staging") throw new PublicActionError("Import is already committed.");
  const document = assemble(staged.chunks);
  if (staged.fileId) requireImportSource(document);
  await verifyAssets(staged.project, document);
  return {
    nodeCount: document.nodes.length,
    artboardCount: document.nodes.filter((node) => node.type === "artboard").length,
    warnings: document.warnings,
    layout: layoutReport(document),
  };
}

export type ImportCommitResult = {
  fileId: string;
  revision: number;
  url: string;
  alreadyCommitted?: boolean;
  nodeCount?: number;
  importedNodeCount?: number;
  nodeIds?: string[];
  warnings?: DesignDocument["warnings"];
} & ReturnType<typeof summarizeImportChunks>;

const designPath = (design: StoredDesign) =>
  `${design.project.path}/.tidy/designs/${design.id}.json`;

export async function commitImport(
  _userId: string,
  importId: string,
  resolution?: "keep_user" | "use_import" | "duplicate",
  folderId?: string | null,
): Promise<ImportCommitResult> {
  const staged = loadImport(importId);
  if (staged.status === "committed")
    return {
      fileId: staged.fileId!,
      revision: staged.committedRevision!,
      url: `${staged.project.path}/.tidy/designs/${staged.fileId}.json`,
      alreadyCommitted: true,
    };
  if (staged.status !== "staging") throw new PublicActionError("Import is not active.");
  const incoming = assemble(staged.chunks);
  if (!layoutReport(incoming).valid)
    throw new PublicActionError(
      "Resolve layout errors before committing. Run validate_import to inspect them.",
    );
  await verifyAssets(staged.project, incoming);
  if (staged.fileId) requireImportSource(incoming);
  let currentDocument: DesignDocument | null = null;
  let saved: StoredDesign;
  if (staged.fileId) {
    const design = await local.findDesign(staged.fileId);
    if (!design) throw new PublicActionError("File not found or access denied.");
    try {
      saved = await local.updateDesign(design, staged.expectedRevision, async (current) => {
        currentDocument = current.document;
        const document = mergeImport(current.document, incoming, importId, resolution);
        await verifyAssets(staged.project, document);
        return { document };
      });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Document changed"))
        throw new PublicActionError(
          "File changed during import. Start a new import from the latest revision.",
        );
      throw error;
    }
  } else {
    const document = mergeImport(null, incoming, importId, resolution);
    await verifyAssets(staged.project, document);
    saved = await local.createDesign(staged.project, {
      name: staged.name,
      document,
      folderId: folderId ?? null,
    });
  }
  staged.fileId = saved.id;
  staged.status = "committed";
  staged.committedRevision = saved.revision;
  const summary = summarizeImportChunks(staged.chunks);
  staged.chunks = {};
  const key = incoming.source
    ? `${incoming.source.project}:${incoming.source.route}`
    : incoming.nodes[0]?.importKey;
  const publishedKey = resolution === "duplicate" && currentDocument ? `${key}#${importId}` : key;
  return {
    fileId: saved.id,
    revision: saved.revision,
    url: designPath(saved),
    importedNodeCount: incoming.nodes.length,
    ...summary,
    nodeCount: saved.document.nodes.length,
    nodeIds: saved.document.nodes
      .filter((node) => node.parentId === null && node.importKey === publishedKey)
      .slice(0, 3)
      .map((node) => node.id),
    warnings: saved.document.warnings,
  };
}

export async function abortImport(_userId: string, importId: string) {
  const staged = imports.get(importId);
  if (!staged || staged.status !== "staging") return { aborted: false };
  staged.status = "aborted";
  staged.chunks = {};
  return { aborted: true };
}

const allowedMime = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);

/** The web service's validation, unchanged: type, size, SVG normalization and magic bytes. */
export async function putAsset(
  _userId: string,
  organizationId: string,
  mimeType: string,
  base64: string,
  _signal?: AbortSignal,
) {
  if (
    !allowedMime.has(mimeType) ||
    base64.length > 2_800_000 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    throw new PublicActionError("Unsupported or oversized asset.");
  let body = Buffer.from(base64, "base64");
  if (body.length < 1 || body.length > 2_000_000)
    throw new PublicActionError("Asset must be 1 byte to 2 MB.");
  if (mimeType === "image/svg+xml") body = Buffer.from(sanitizeSvgAsset(body.toString("utf8")));
  const signature = body.subarray(0, 16);
  if (mimeType === "image/png" && signature.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new PublicActionError("Invalid PNG.");
  if (mimeType === "image/jpeg" && signature.subarray(0, 2).toString("hex") !== "ffd8")
    throw new PublicActionError("Invalid JPEG.");
  if (
    mimeType === "image/webp" &&
    (signature.subarray(0, 4).toString() !== "RIFF" ||
      signature.subarray(8, 12).toString() !== "WEBP")
  )
    throw new PublicActionError("Invalid WebP.");
  const project = await local.projects.resolve(organizationId);
  return local.putAsset(project, mimeType, body);
}

export async function patchDocumentNode(
  userId: string,
  fileId: string,
  expectedRevision: number,
  nodeId: string,
  changes: DesignNodeChanges,
  options: { designTokens?: DesignTokens } = {},
) {
  const saved = await patchNodes(
    userId,
    fileId,
    expectedRevision,
    [{ nodeId, changes }],
    false,
    options,
  );
  return { revision: saved.revision, node: saved.nodes[0], document: saved.document };
}

export function patchDocumentNodes(
  userId: string,
  fileId: string,
  expectedRevision: number,
  edits: { nodeId: string; changes: DesignNodeChanges }[],
  options: { designTokens?: DesignTokens } = {},
) {
  return patchNodes(userId, fileId, expectedRevision, edits, true, options);
}

async function patchNodes(
  _userId: string,
  fileId: string,
  expectedRevision: number,
  edits: { nodeId: string; changes: DesignNodeChanges }[],
  requireTargets: boolean,
  options: { designTokens?: DesignTokens },
) {
  if (edits.length < 1 || edits.length > 250)
    throw new PublicActionError("Provide between 1 and 250 layer edits.");
  const design = await local.findDesign(fileId);
  if (!design) throw new PublicActionError("Document not found or access denied.");
  const saved = await local.updateDesign(design, expectedRevision, async (current) => {
    const existing = new Set(current.document.nodes.map((node) => node.id));
    if (
      (requireTargets || options.designTokens) &&
      edits.some((edit) => !existing.has(edit.nodeId))
    )
      throw new PublicActionError("Layer not found. Refresh before editing.");
    const content = options.designTokens
      ? mergeDesignTokens(current.document, options.designTokens)
      : current.document;
    const nodes = changedLayerBatch(content, edits);
    const document = trackDocumentChanges(current.document, {
      ...content,
      nodes,
      editedNodeIds: [
        ...new Set([...current.document.editedNodeIds, ...edits.map((edit) => edit.nodeId)]),
      ],
    });
    await verifyAssets(current.project, document);
    return { document };
  });
  const byId = new Map(saved.document.nodes.map((node) => [node.id, node]));
  return {
    revision: saved.revision,
    nodes: [...new Set(edits.map((edit) => edit.nodeId))].flatMap((id) =>
      byId.has(id) ? [byId.get(id)!] : [],
    ),
    document: saved.document,
  };
}
