import { createHash, randomUUID } from "node:crypto";
import { lstat, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import {
  blankDesignDocument,
  parseDesignDocument,
  type DesignDocument,
} from "@tidy/design/document";
import { readDesignFile } from "../../../desktop/src/main/design-file";
import { readLocalFile } from "../../../desktop/src/main/local-files";
import { LocalProjects, type LocalProject } from "./projects";

const uuid = z.uuid();
const name = z.string().trim().min(1).max(120);
const folderSchema = z.object({ id: uuid, name });
const assetSchema = z.object({ dataUrl: z.string().max(3_000_000) });
const dataUrlPattern = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/=]+)$/;
const MAX_FILE_BYTES = 16 * 1024 * 1024;

export type StoredDesign = {
  project: LocalProject;
  id: string;
  name: string;
  folderId: string | null;
  document: DesignDocument;
  revision: number;
  updatedAt: string;
};

type DesignChange = { name?: string; folderId?: string | null; document?: DesignDocument };

/** Integer revisions for the MCP contract, derived from the file's content hash so
 * edits made in the desktop app, by agents or while this server was stopped all
 * change the revision. Only equality matters; 48 bits stays a safe integer. */
export const revisionOf = (version: string) => Number.parseInt(version.slice(0, 12), 16) + 1;

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

export class LocalDesignStore {
  private writes = Promise.resolve();
  private assetHashes = new Map<string, string>();

  constructor(readonly projects = new LocalProjects()) {}

  /** Mirrors the desktop store: real directories, UUID file names, no symlinked files. */
  private async storagePath(
    project: LocalProject,
    kind: "designs" | "assets" | "folders",
    id?: string,
  ) {
    for (const directory of [join(project.path, ".tidy"), join(project.path, ".tidy", kind)]) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Project .tidy storage must be a real directory.");
    }
    if (id !== undefined) uuid.parse(id);
    const path = join(project.path, ".tidy", kind, ...(id ? [`${id}.json`] : []));
    if (id) {
      try {
        const info = await lstat(path);
        if (!info.isFile() || info.isSymbolicLink())
          throw new Error("Project files must not be symbolic links.");
      } catch (error) {
        if (!missing(error)) throw error;
      }
    }
    return path;
  }

  /** Serialize writes in this process; each write is a temp file plus atomic rename. */
  private serialized<T>(work: () => Promise<T>) {
    const next = this.writes.then(work);
    this.writes = next.then(
      () => {},
      () => {},
    );
    return next;
  }

  private async writeAtomic(path: string, value: unknown) {
    const json = JSON.stringify(value, null, 2);
    if (Buffer.byteLength(json) > MAX_FILE_BYTES)
      throw new Error("The local project file reached its size limit.");
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, json, { mode: 0o600, flag: "wx" });
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true });
    }
  }

  private async ids(project: LocalProject, kind: "designs" | "folders") {
    return (await readdir(await this.storagePath(project, kind)))
      .filter((file) => file.endsWith(".json") && uuid.safeParse(file.slice(0, -5)).success)
      .map((file) => file.slice(0, -5));
  }

  async readDesign(project: LocalProject, designId: string): Promise<StoredDesign> {
    const file = await readDesignFile(await this.storagePath(project, "designs", designId));
    return {
      project,
      id: file.id,
      name: file.name,
      folderId: file.folderId ?? null,
      document: file.document,
      revision: revisionOf(file.version),
      updatedAt: file.updatedAt,
    };
  }

  /** Design IDs are UUIDs, so a file ID identifies one design across known projects. */
  async findDesign(designId: string): Promise<StoredDesign | null> {
    if (!uuid.safeParse(designId).success) return null;
    for (const project of await this.projects.list()) {
      try {
        await stat(await this.storagePath(project, "designs", designId));
      } catch {
        continue;
      }
      return this.readDesign(project, designId);
    }
    return null;
  }

  async requireDesign(designId: string) {
    const design = await this.findDesign(designId);
    if (!design) throw new Error("File not found. Call list_files for design IDs.");
    return design;
  }

  async listDesigns(project: LocalProject) {
    const designs = await Promise.all(
      (await this.ids(project, "designs")).map(async (id) => {
        try {
          const { document, ...design } = await this.readDesign(project, id);
          return { ...design, nodeCount: document.nodes.length };
        } catch {
          return null;
        }
      }),
    );
    return designs
      .filter((design) => design !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async createDesign(
    project: LocalProject,
    input: { name: string; document?: DesignDocument; folderId?: string | null },
  ) {
    const folderId = input.folderId ?? null;
    if (folderId !== null) await this.readFolder(project, folderId);
    const designId = randomUUID();
    const document = parseDesignDocument(input.document ?? blankDesignDocument());
    await this.serialized(async () =>
      this.writeAtomic(await this.storagePath(project, "designs", designId), {
        id: designId,
        name: name.parse(input.name),
        folderId,
        document,
      }),
    );
    return this.readDesign(project, designId);
  }

  /** Compare-and-swap against the content revision, then write atomically. */
  async updateDesign(
    design: { project: LocalProject; id: string },
    expectedRevision: number | null,
    change: (current: StoredDesign) => DesignChange | Promise<DesignChange>,
  ) {
    return this.serialized(async () => {
      const current = await this.readDesign(design.project, design.id);
      if (expectedRevision !== null && current.revision !== expectedRevision)
        throw new Error("Document changed. Refresh before editing.");
      const next = await change(current);
      if (next.folderId) await this.readFolder(design.project, next.folderId);
      await this.writeAtomic(await this.storagePath(design.project, "designs", design.id), {
        id: current.id,
        name: next.name === undefined ? current.name : name.parse(next.name),
        folderId: next.folderId === undefined ? current.folderId : next.folderId,
        document: parseDesignDocument(next.document ?? current.document),
      });
      return this.readDesign(design.project, design.id);
    });
  }

  async readFolder(project: LocalProject, folderId: string) {
    const path = await this.storagePath(project, "folders", folderId);
    const folder = folderSchema.parse(JSON.parse((await readLocalFile(path)).toString("utf8")));
    if (folder.id !== folderId) throw new Error("Folder ID does not match its filename.");
    return { ...folder, updatedAt: (await stat(path)).mtime.toISOString() };
  }

  async listFolders(project: LocalProject) {
    const folders = await Promise.all(
      (await this.ids(project, "folders")).map((id) =>
        this.readFolder(project, id).catch(() => null),
      ),
    );
    return folders
      .filter((folder) => folder !== null)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async writeFolder(project: LocalProject, folderId: string, folderName: string) {
    await this.serialized(async () =>
      this.writeAtomic(await this.storagePath(project, "folders", folderId), {
        id: folderId,
        name: name.parse(folderName),
      }),
    );
    return this.readFolder(project, folderId);
  }

  /** Like the web service: files in the folder become unfiled, then the folder is removed. */
  async deleteFolder(project: LocalProject, folderId: string) {
    await this.readFolder(project, folderId);
    let unfiled = 0;
    for (const design of await this.listDesigns(project)) {
      if (design.folderId !== folderId) continue;
      await this.updateDesign(design, null, () => ({ folderId: null }));
      unfiled++;
    }
    await this.serialized(async () => rm(await this.storagePath(project, "folders", folderId)));
    return { id: folderId, unfiledFileCount: unfiled };
  }

  async putAsset(project: LocalProject, mimeType: string, body: Buffer) {
    const hash = createHash("sha256").update(body).digest("hex");
    const key = `${project.path}:${mimeType}:${hash}`;
    const known = this.assetHashes.get(key);
    if (known && (await this.readAsset(project, known).catch(() => null)))
      return { assetId: known, sha256: hash };
    const assetId = randomUUID();
    const dataUrl = `data:${mimeType};base64,${body.toString("base64")}`;
    if (dataUrl.length > 3_000_000) throw new Error("Asset must be 1 byte to 2 MB.");
    await this.serialized(async () =>
      this.writeAtomic(await this.storagePath(project, "assets", assetId), { dataUrl }),
    );
    this.assetHashes.set(key, assetId);
    return { assetId, sha256: hash };
  }

  /** Export calls name assets without a file, so look in each known project. */
  async findAsset(assetId: string) {
    if (!uuid.safeParse(assetId).success) return null;
    for (const project of await this.projects.list()) {
      const asset = await this.readAsset(project, assetId).catch(() => null);
      if (asset) return asset;
    }
    return null;
  }

  async readAsset(project: LocalProject, assetId: string) {
    const path = await this.storagePath(project, "assets", assetId);
    const { dataUrl } = assetSchema.parse(JSON.parse((await readLocalFile(path)).toString("utf8")));
    const match = dataUrlPattern.exec(dataUrl);
    if (!match) throw new Error("Unsupported local image.");
    return { id: assetId, mimeType: match[1], base64: match[2] };
  }
}
