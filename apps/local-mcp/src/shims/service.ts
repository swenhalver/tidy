/** Local replacement for apps/web/lib/design/service.ts: Tidy desktop projects
 * stand in for organizations, and their `.tidy/designs` files for design files. */
import { local } from "../local/context";

export type DesignFrame = { id: string; x: number; y: number; width: number; height: number };
export type FrameInput = Omit<DesignFrame, "id">;
export type DesignRectangle = DesignFrame;
export type RectangleInput = FrameInput;

// Validation copied from the web service, which also imports its database client.
export function cleanDesignName(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= 120 && !/[\u0000-\u001f\u007f]/.test(trimmed)
    ? trimmed
    : null;
}

export function validDesignFrame(frame: FrameInput) {
  const values = [frame.x, frame.y, frame.width, frame.height];
  return (
    values.every(Number.isSafeInteger) &&
    frame.x >= 0 &&
    frame.y >= 0 &&
    frame.x <= 100000 &&
    frame.y <= 100000 &&
    frame.width >= 40 &&
    frame.height >= 40 &&
    frame.width <= 5000 &&
    frame.height <= 5000
  );
}

export function validDesignRectangle(rectangle: RectangleInput) {
  const values = [rectangle.x, rectangle.y, rectangle.width, rectangle.height];
  return (
    values.every(Number.isSafeInteger) &&
    rectangle.x >= 0 &&
    rectangle.y >= 0 &&
    rectangle.x <= 100000 &&
    rectangle.y <= 100000 &&
    rectangle.width >= 1 &&
    rectangle.height >= 1 &&
    rectangle.width <= 5000 &&
    rectangle.height <= 5000
  );
}

export async function listDesignOrganizations(_userId: string) {
  return (await local.projects.list()).map((project) => ({
    id: project.id,
    name: project.name,
    path: project.path,
    canEdit: true,
  }));
}

export async function listDesignFiles(_userId: string, organizationId: string) {
  const project = await local.projects.resolve(organizationId);
  return (await local.listDesigns(project)).map((design) => ({
    id: design.id,
    name: design.name,
    folderId: design.folderId,
    updatedAt: design.updatedAt,
    nodeCount: design.nodeCount,
    role: "owner",
  }));
}

// Local files have no legacy shape tables or archive, so both flags are no-ops.
export async function getDesignFile(
  _userId: string,
  fileId: string,
  _legacy = true,
  _includeArchived = false,
) {
  const design = await local.findDesign(fileId);
  if (!design) return null;
  return {
    id: design.id,
    name: design.name,
    organizationId: design.project.id,
    organizationName: design.project.name,
    folderId: design.folderId,
    updatedAt: design.updatedAt,
    archivedAt: null,
    role: "owner",
    path: `${design.project.path}/.tidy/designs/${design.id}.json`,
    frames: [] as DesignFrame[],
    rectangles: [] as DesignRectangle[],
  };
}

export async function createDesignFileForUser(
  _userId: string,
  organizationId: string,
  name: string,
) {
  const cleanName = cleanDesignName(name);
  if (!cleanName) throw new Error("Enter a name of up to 120 characters.");
  const project = await local.projects.resolve(organizationId);
  const design = await local.createDesign(project, { name: cleanName });
  return { id: design.id, name: design.name };
}

export async function renameDesignFileForUser(_userId: string, fileId: string, name: string) {
  const cleanName = cleanDesignName(name);
  if (!cleanName) throw new Error("Enter a name of up to 120 characters.");
  const design = await local.requireDesign(fileId);
  await local.updateDesign(design, null, () => ({ name: cleanName }));
  return { id: fileId, name: cleanName };
}
