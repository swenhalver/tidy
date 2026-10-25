/** Local replacement for apps/web/lib/design/folder-service.ts, using the desktop
 * app's `.tidy/folders` files. */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { local } from "../local/context";
import type { LocalProject } from "../local/projects";

const folderId = z.uuid();

async function findFolder(id: string) {
  folderId.parse(id);
  for (const project of await local.projects.list()) {
    const folder = await local.readFolder(project, id).catch(() => null);
    if (folder) return { project, folder };
  }
  throw new Error("Folder not found or access denied.");
}

const publicFolder = (
  project: LocalProject,
  folder: { id: string; name: string; updatedAt: string },
) => ({ ...folder, organizationId: project.id, canEdit: true });

export async function listDesignFolders(_userId: string, organizationId: string) {
  const project = await local.projects.resolve(organizationId);
  return (await local.listFolders(project)).map((folder) => publicFolder(project, folder));
}

export async function createDesignFolderForUser(
  _userId: string,
  organizationId: string,
  name: string,
) {
  const project = await local.projects.resolve(organizationId);
  return publicFolder(project, await local.writeFolder(project, randomUUID(), name));
}

export async function renameDesignFolderForUser(_userId: string, id: string, name: string) {
  const { project } = await findFolder(id);
  return publicFolder(project, await local.writeFolder(project, id, name));
}

export async function moveDesignFileForUser(
  _userId: string,
  fileId: string,
  targetFolderId: string | null,
) {
  const design = await local.requireDesign(fileId);
  if (targetFolderId !== null)
    await local.readFolder(design.project, folderId.parse(targetFolderId));
  const saved = await local.updateDesign(design, null, () => ({ folderId: targetFolderId }));
  return {
    id: saved.id,
    organizationId: saved.project.id,
    name: saved.name,
    folderId: saved.folderId,
    updatedAt: saved.updatedAt,
  };
}

export async function deleteDesignFolderForUser(_userId: string, id: string) {
  const { project } = await findFolder(id);
  return local.deleteFolder(project, id);
}
