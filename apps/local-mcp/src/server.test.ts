import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readDesignFile } from "../../desktop/src/main/workspace/design-file";

const app = fileURLToPath(new URL("..", import.meta.url));
let directory: string, home: string, project: string, other: string;
let server: ReturnType<typeof Bun.spawn<"pipe", "pipe", "pipe">>;
let buffer = "",
  serial = 0;
const waiting = new Map<number, (value: { result?: any; error?: any }) => void>();

async function pump() {
  const decoder = new TextDecoder();
  for await (const chunk of server.stdout) {
    buffer += decoder.decode(chunk);
    let end: number;
    while ((end = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, end));
      buffer = buffer.slice(end + 1);
      waiting.get(message.id)?.(message);
      waiting.delete(message.id);
    }
  }
}

function send(message: object) {
  server.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...message }) + "\n");
  server.stdin.flush();
}

function request(method: string, params: object = {}) {
  const id = ++serial;
  const reply = new Promise<{ result?: any; error?: any }>((resolve) => waiting.set(id, resolve));
  send({ id, method, params });
  return reply;
}

async function call(name: string, args: object = {}) {
  const { result, error } = await request("tools/call", { name, arguments: args });
  if (error) throw new Error(error.message);
  const text = result.content.find((item: { type: string }) => item.type === "text")?.text;
  if (result.isError) throw new Error(text);
  return result.structuredContent ?? JSON.parse(text);
}

beforeAll(async () => {
  const build = Bun.spawnSync([process.execPath, "scripts/build.ts"], { cwd: app, stderr: "pipe" });
  if (build.exitCode !== 0) throw new Error(build.stderr.toString());
  directory = await realpath(await mkdtemp(join(tmpdir(), "tidy-local-mcp-")));
  project = join(directory, "project");
  other = join(directory, "other");
  home = join(directory, "home");
  for (const folder of [".secret", "Library/Fonts", "Work/site", "Work/.cache/site"])
    await Bun.write(join(home, folder, "README.md"), "fixture");
  await Bun.write(join(project, "README.md"), "fixture");
  await Bun.write(join(other, "README.md"), "fixture");
  server = Bun.spawn([process.execPath, join(app, "dist/tidy-mcp.js")], {
    cwd: directory,
    env: {
      ...process.env,
      HOME: home,
      TIDY_PROJECT: project,
      TIDY_DESKTOP_REGISTRY: join(directory, "missing-registry.json"),
    },
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  void pump();
  const init = await request("initialize", {
    protocolVersion: "2025-11-25",
    capabilities: {},
    clientInfo: { name: "test", version: "1" },
  });
  expect(init.result.serverInfo.name).toBe("Tidy local");
  expect(init.result.instructions).toContain("No Tidy account");
  send({ method: "notifications/initialized" });
});

afterAll(async () => {
  server?.kill();
  await rm(directory, { recursive: true, force: true });
});

test("exposes the design tools without account-only integrations", async () => {
  const { result } = await request("tools/list");
  const names = result.tools.map((tool: { name: string }) => tool.name);
  for (const name of [
    "list_organizations",
    "create_file",
    "get_document",
    "patch_document",
    "compose_component",
    "create_import",
    "commit_import",
    "export_component",
    "get_file_image",
    "export_visual_preview",
    "create_folder",
  ])
    expect(names).toContain(name);
  expect(names.some((name: string) => /github|linear|preview_design/.test(name))).toBe(false);
});

test("creates, imports, edits and exports designs in .tidy project files", async () => {
  const { organizations } = await call("list_organizations");
  expect(organizations).toEqual([
    expect.objectContaining({ name: "project", path: project, canEdit: true }),
  ]);
  const projectId = organizations[0].id;
  expect(JSON.parse(await readFile(join(project, ".tidy/project.json"), "utf8")).id).toBe(
    projectId,
  );

  const { file } = await call("create_file", { organization_id: projectId, name: "Blank" });
  const blank = await readDesignFile(join(project, ".tidy/designs", `${file.id}.json`));
  expect(blank.name).toBe("Blank");

  const composed = await call("compose_component", {
    tree: {
      id: "button",
      name: "Button",
      type: "container",
      layout: "flex-row",
      align: "center",
      justify: "center",
      paddingTop: 8,
      paddingBottom: 8,
      paddingLeft: 12,
      paddingRight: 12,
      semantics: { element: "button", buttonType: "button" },
      style: { fill: "#222222", radius: 6 },
      children: [
        {
          id: "label",
          name: "Label",
          type: "text",
          text: "Save",
          style: { fontFamily: "system-ui", fontSize: 14, color: "#ffffff" },
        },
      ],
    },
  });
  const staging = await call("create_import", { organization_id: projectId, name: "Buttons" });
  await call("put_import_chunk", {
    import_id: staging.importId,
    chunk_id: "0001",
    nodes: composed.document.nodes,
    source: { project: "test", route: "/buttons" },
  });
  expect((await call("validate_import", { import_id: staging.importId })).layout.valid).toBe(true);
  const committed = await call("commit_import", { import_id: staging.importId });
  expect(committed.url).toBe(join(project, ".tidy/designs", `${committed.fileId}.json`));
  expect(await call("commit_import", { import_id: staging.importId })).toMatchObject({
    alreadyCommitted: true,
    fileId: committed.fileId,
  });

  const { files } = await call("list_files", { organization_id: projectId });
  expect(files.map((item: { name: string }) => item.name).sort()).toEqual(["Blank", "Buttons"]);

  const { document } = await call("get_document", { file_id: committed.fileId });
  expect(document.revision).toBe(committed.revision);
  const label = document.content.nodes.find((node: { name: string }) => node.name === "Label");
  const patched = await call("patch_document", {
    file_id: committed.fileId,
    expected_revision: document.revision,
    node_id: label.id,
    changes: { text: "Publish" },
    include_document: false,
  });
  expect(patched.revision).not.toBe(document.revision);
  const onDisk = await readDesignFile(join(project, ".tidy/designs", `${committed.fileId}.json`));
  expect(onDisk.document.nodes.find((node) => node.id === label.id)?.text).toBe("Publish");
  await expect(
    call("patch_document", {
      file_id: committed.fileId,
      expected_revision: document.revision,
      node_id: label.id,
      changes: { text: "Stale" },
    }),
  ).rejects.toThrow("Document changed");

  const page = await call("get_document", { file_id: committed.fileId, offset: 0, limit: 1 });
  expect(page).toMatchObject({ revision: patched.revision, totalNodes: 2, nextOffset: 1 });

  const root = onDisk.document.nodes.find((node) => node.parentId === null)!;
  const exported = await call("export_component", {
    file_id: committed.fileId,
    node_id: root.id,
    component_name: "SaveButton",
  });
  expect(JSON.stringify(exported)).toContain("SaveButton");
});

test("stores assets and folders in the desktop formats", async () => {
  const [{ id: projectId }] = (await call("list_organizations")).organizations;
  const png =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const asset = await call("put_asset", {
    organization_id: projectId,
    mime_type: "image/png",
    base64: png,
  });
  const stored = JSON.parse(
    await readFile(join(project, ".tidy/assets", `${asset.assetId}.json`), "utf8"),
  );
  expect(stored.dataUrl).toBe(`data:image/png;base64,${png}`);

  const { folder } = await call("create_folder", { organization_id: projectId, name: "Screens" });
  const { file } = await call("create_file", { organization_id: projectId, name: "Filed" });
  await call("move_file", { file_id: file.id, folder_id: folder.id });
  expect((await readDesignFile(join(project, ".tidy/designs", `${file.id}.json`))).folderId).toBe(
    folder.id,
  );
  expect(await call("delete_folder", { folder_id: folder.id })).toMatchObject({
    deleted: { unfiledFileCount: 1 },
  });
  expect(await readdir(join(project, ".tidy/folders"))).toEqual([]);
});

test("normalizes SVG assets like the web service and refuses active content", async () => {
  const [{ id: projectId }] = (await call("list_organizations")).organizations;
  const svg = (source: string) =>
    call("put_asset", {
      organization_id: projectId,
      mime_type: "image/svg+xml",
      base64: Buffer.from(source).toString("base64"),
    });
  const namespace = "http://www.w3.org/2000/svg";
  // None of these match the old regex check, which only saw unprefixed tags and literal text.
  for (const source of [
    `<svg xmlns="${namespace}"><s:script xmlns:s="${namespace}">void 0</s:script></svg>`,
    `<svg xmlns="${namespace}"><f:foreignObject xmlns:f="${namespace}"/></svg>`,
    '<svg><use href="&#104;ttps://example.test/image"/></svg>',
    "<svg><style>rect{fill:u\\72l(https://example.test/image)}</style></svg>",
    '<svg><rect style="fill:url(https://example.test/image)"/></svg>',
    '<svg><rect onload="alert(1)"/></svg>',
    '<!DOCTYPE svg [<!ENTITY value "content">]><svg/>',
    "not an svg",
  ])
    await expect(svg(source)).rejects.toThrow("unsupported content");

  // Gradient and local references are static content the old check wrongly refused.
  const asset = await svg(`<s:svg xmlns:s="${namespace}" viewBox="0 0 20 20">
    <s:defs><s:linearGradient id="paint"><s:stop offset="0" stop-color="#fff"/></s:linearGradient></s:defs>
    <s:rect width="20" height="20" fill="url(#paint)"/>
  </s:svg>`);
  const stored = JSON.parse(
    await readFile(join(project, ".tidy/assets", `${asset.assetId}.json`), "utf8"),
  );
  const markup = Buffer.from(stored.dataUrl.split(",")[1], "base64").toString("utf8");
  expect(markup).toContain('fill="url(#paint)"');
  expect(markup).toContain(`<svg xmlns="${namespace}"`);
  expect(markup).not.toContain("s:");
});

test("opens ordinary folders by absolute path and refuses sensitive ones", async () => {
  const { file } = await call("create_file", { organization_id: other, name: "Elsewhere" });
  expect(await readdir(join(other, ".tidy/designs"))).toEqual([`${file.id}.json`]);
  await call("create_file", { organization_id: join(home, "Work/site"), name: "Site" });
  expect(await readdir(join(home, "Work/site/.tidy/designs"))).toHaveLength(1);
  await expect(call("list_files", { organization_id: "relative/path" })).rejects.toThrow();
  for (const refused of [
    home,
    directory,
    "/",
    "/usr",
    join(home, ".secret"),
    join(home, "Library/Fonts"),
    join(home, "Work/.cache/site"),
  ]) {
    await expect(call("create_file", { organization_id: refused, name: "Nope" })).rejects.toThrow();
    await expect(readdir(join(refused, ".tidy"))).rejects.toThrow();
  }
  await writeFile(join(directory, "note.txt"), "x");
  await expect(
    call("create_file", { organization_id: join(directory, "note.txt"), name: "Nope" }),
  ).rejects.toThrow();
});
