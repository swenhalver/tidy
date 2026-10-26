import { randomUUID } from "node:crypto";
import { lstat, mkdir, realpath, stat, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { basename, isAbsolute, join, parse, relative, sep } from "node:path";
import { z } from "zod";
import { readLocalFile } from "../../../desktop/src/main/platform/local-files";

export type LocalProject = { id: string; name: string; path: string };

const uuid = z.uuid();
const registrySchema = z.object({
  projects: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        path: z.string(),
        cloud: z.boolean().optional(),
      }),
    )
    .max(100),
  activeProjectId: z.string().nullable().optional(),
});

/** The desktop app's private project registry, written by Electron's userData. */
export function desktopRegistryPath() {
  if (process.env.TIDY_DESKTOP_REGISTRY) return process.env.TIDY_DESKTOP_REGISTRY;
  const base =
    process.platform === "darwin"
      ? join(homedir(), "Library", "Application Support")
      : process.platform === "win32"
        ? (process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"))
        : (process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"));
  return join(base, "Tidy", "workspace", "projects.json");
}

const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === "ENOENT";

async function realDirectory(path: string) {
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink())
    throw new Error("Project .tidy storage must be a real directory.");
}

/** Same layout and ignore rules the desktop app creates when it opens a folder. */
async function prepare(path: string) {
  for (const name of ["", "threads", "designs", "assets", "folders", "attachments"]) {
    const directory = join(path, ".tidy", name);
    try {
      await mkdir(directory, { mode: 0o700 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
    await realDirectory(directory);
  }
  try {
    await writeFile(
      join(path, ".tidy", ".gitignore"),
      "/threads/\n/attachments/\n/project.json\n",
      {
        flag: "wx",
        mode: 0o600,
      },
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
}

async function projectIdentity(path: string) {
  const metadata = join(path, ".tidy", "project.json");
  try {
    return z
      .object({ version: z.literal(1), id: uuid })
      .parse(JSON.parse((await readLocalFile(metadata, 64 * 1024)).toString("utf8"))).id;
  } catch (error) {
    if (!missing(error)) throw new Error("Project metadata in .tidy/project.json is invalid.");
  }
  const id = randomUUID();
  try {
    await writeFile(metadata, JSON.stringify({ version: 1, id }), { flag: "wx", mode: 0o600 });
    return id;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    return projectIdentity(path);
  }
}

/** Agents may name new project folders, but only ordinary ones: inside the home folder
 * (excluding hidden folders and ~/Library), temporary folders, or external volumes. */
async function assertProjectFolder(path: string) {
  const inside = (parent: string) => path === parent || path.startsWith(parent + sep);
  const home = await realpath(homedir());
  if (inside(home)) {
    const segments = relative(home, path).split(sep);
    if (segments[0] === "Library" || segments.some((segment) => segment.startsWith(".")))
      throw new Error("Choose an ordinary project folder, not a hidden or Library folder.");
    return;
  }
  const temporary = await Promise.all(
    [tmpdir(), "/tmp"].map((directory) => realpath(directory).catch(() => null)),
  );
  if (temporary.some((directory) => directory && inside(directory))) return;
  if (relative("/Volumes", path).split(sep).length >= 2 && inside("/Volumes")) return;
  throw new Error("Choose a project folder inside your home folder.");
}

export class LocalProjects {
  /** Folders opened by absolute path during this session, in addition to the registry. */
  private opened = new Map<string, LocalProject>();

  constructor(
    private registryPath = desktopRegistryPath(),
    private defaultDirectory = process.env.TIDY_PROJECT,
  ) {}

  private async registered(): Promise<LocalProject[]> {
    let registry: z.infer<typeof registrySchema>;
    try {
      registry = registrySchema.parse(
        JSON.parse((await readLocalFile(this.registryPath, 1024 * 1024)).toString("utf8")),
      );
    } catch (error) {
      if (missing(error)) return [];
      throw new Error("The Tidy desktop project list could not be read.");
    }
    const projects = await Promise.all(
      registry.projects
        .filter((project) => !project.cloud && uuid.safeParse(project.id).success)
        .map(async (project) => {
          try {
            const path = await realpath(project.path);
            await realDirectory(join(path, ".tidy"));
            return { id: project.id, name: project.name, path };
          } catch {
            return null;
          }
        }),
    );
    const available = projects.filter((project) => project !== null);
    const active = available.find((project) => project.id === registry.activeProjectId);
    return active ? [active, ...available.filter((project) => project !== active)] : available;
  }

  private async defaultProject() {
    for (const candidate of [this.defaultDirectory, process.cwd()]) {
      if (!candidate) continue;
      try {
        const path = await realpath(candidate);
        // The working directory only counts when it is already a Tidy project.
        if (candidate !== this.defaultDirectory) await realDirectory(join(path, ".tidy"));
        return await this.open(path, true);
      } catch {
        /* Fall through to the next candidate. */
      }
    }
    return null;
  }

  /** Registered desktop projects first, then any default or explicitly opened folder. */
  async list(): Promise<LocalProject[]> {
    const projects = await this.registered();
    const fallback = await this.defaultProject();
    const all = [...projects, ...(fallback ? [fallback] : []), ...this.opened.values()];
    const seen = new Set<string>();
    return all.filter((project) => {
      if (seen.has(project.path) || seen.has(project.id)) return false;
      seen.add(project.path);
      seen.add(project.id);
      return true;
    });
  }

  /** Open a folder by absolute path, creating its .tidy storage like the desktop app.
   * Folders named by an agent must pass assertProjectFolder; TIDY_PROJECT is trusted. */
  async open(directory: string, trusted = false): Promise<LocalProject> {
    if (!isAbsolute(directory)) throw new Error("Use an absolute project folder path.");
    const path = await realpath(directory);
    if (!(await stat(path)).isDirectory()) throw new Error("Choose a project folder.");
    const home = await realpath(homedir());
    if (path === parse(path).root || path === home || home.startsWith(path + sep))
      throw new Error("Choose a specific project folder, not your home or root folder.");
    if (!trusted) await assertProjectFolder(path);
    const existing = [...this.opened.values()].find((project) => project.path === path);
    if (existing) return existing;
    await prepare(path);
    const project = { id: await projectIdentity(path), name: basename(path), path };
    this.opened.set(project.id, project);
    return project;
  }

  /** Accepts a project ID from list_organizations or an absolute folder path. */
  async resolve(organizationId: string): Promise<LocalProject> {
    const known = await this.list();
    if (isAbsolute(organizationId)) {
      const path = await realpath(organizationId);
      return known.find((item) => item.path === path) ?? this.open(path);
    }
    const project = known.find((item) => item.id === organizationId);
    if (!project) throw new Error("Project not found. Call list_organizations for project IDs.");
    return project;
  }
}
