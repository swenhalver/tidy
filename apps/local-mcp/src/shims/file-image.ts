/** Local replacement for apps/web/lib/design/file-image.ts. */
import { nodeAssetIds } from "@/lib/design/document";
import { local } from "../local/context";

const unavailable = "Image not found in this file or access denied.";

export async function getFileImage(_userId: string, fileId: string, assetId: string) {
  const design = await local.findDesign(fileId);
  if (!design) throw new Error(unavailable);
  const nodes = design.document.nodes.filter((node) => nodeAssetIds(node).includes(assetId));
  if (!nodes.length) throw new Error(unavailable);
  const asset = await local.readAsset(design.project, assetId).catch(() => null);
  if (!asset) throw new Error(unavailable);
  return {
    fileId,
    assetId,
    revision: design.revision,
    mimeType: asset.mimeType,
    byteSize: Buffer.from(asset.base64, "base64").length,
    base64: asset.base64,
    layers: nodes.map((node) => ({
      nodeId: node.id,
      name: node.name,
      type: node.type,
      box: node.box,
      imageCrop: node.style.imageCrop,
      paints: node.style.paints,
    })),
  };
}
