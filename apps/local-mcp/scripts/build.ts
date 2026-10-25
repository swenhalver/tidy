/**
 * Bundle the web app's MCP tools into one local stdio server. Web modules that
 * reach Postgres, R2 or account services are redirected to `.tidy` file-backed
 * shims; the build fails if anything still pulls in a database or Workers module.
 */
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { BunPlugin } from "bun";

const app = fileURLToPath(new URL("..", import.meta.url));
const web = resolve(app, "../web");
const shims = join(app, "src/shims");

/** Web module (without extension) → local replacement. */
const redirects = new Map([
  [join(web, "lib/design/document-service"), join(shims, "document-service.ts")],
  [join(web, "lib/design/service"), join(shims, "service.ts")],
  [join(web, "lib/design/folder-service"), join(shims, "folder-service.ts")],
  [join(web, "lib/design/file-image"), join(shims, "file-image.ts")],
  [join(web, "lib/mcp/activity"), join(shims, "runtime.ts")],
  [join(web, "lib/action-error"), join(shims, "runtime.ts")],
  [join(web, "lib/github/mcp"), join(shims, "runtime.ts")],
  [join(web, "lib/linear/mcp"), join(shims, "runtime.ts")],
  [join(web, "lib/mcp/plugin-tools"), join(shims, "runtime.ts")],
]);
const packages = new Map([
  ["next/cache", join(shims, "runtime.ts")],
  ["server-only", join(shims, "empty.ts")],
]);
const forbidden = /^(pg|pg-[\w-]+|@opennextjs\/.*|cloudflare:.*|next(\/.*)?|better-auth.*)$/;
const forbiddenWeb = ["lib/db", "lib/storage/", "lib/realtime/server", "lib/organizations/"].map(
  (path) => join(web, path),
);

const localModules: BunPlugin = {
  name: "tidy-local-modules",
  setup(build) {
    build.onResolve({ filter: /.*/ }, (args) => {
      const target = packages.get(args.path);
      if (target) return { path: target };
      if (forbidden.test(args.path))
        throw new Error(`${relative(app, args.importer)} imports hosted module ${args.path}`);
      const base = args.path.startsWith("@/")
        ? join(web, args.path.slice(2))
        : args.path.startsWith(".")
          ? resolve(dirname(args.importer), args.path)
          : null;
      if (!base) return;
      const stripped = base.replace(/\.(ts|tsx|js|mjs)$/, "");
      const redirect = redirects.get(stripped);
      if (redirect && args.importer !== redirect) return { path: redirect };
      if (forbiddenWeb.some((path) => stripped === path || stripped.startsWith(path)))
        throw new Error(`${relative(app, args.importer)} imports hosted module ${args.path}`);
    });
  },
};

const result = await Bun.build({
  entrypoints: [join(app, "src/main.ts")],
  outdir: join(app, "dist"),
  naming: "tidy-mcp.js",
  target: "bun",
  format: "esm",
  minify: false,
  // Bun's bundler mis-orders zod's circular namespace imports; load it from node_modules.
  external: ["zod", "zod/*"],
  plugins: [localModules],
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}
console.info(`Built ${relative(process.cwd(), result.outputs[0].path)}`);
