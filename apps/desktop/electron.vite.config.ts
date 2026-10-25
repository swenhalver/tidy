import react from "@vitejs/plugin-react";
import { defineConfig } from "electron-vite";
import { bundleLicenseBannerForInputs } from "../../scripts/bundle-licenses";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const licenceBanner = (chunk: { modules: Record<string, unknown> }) =>
  bundleLicenseBannerForInputs(Object.keys(chunk.modules));

/** Where this build came from, for the upstream review prompt. Missing git is not an error. */
function buildSource() {
  const checkout = fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
  let fork: string | undefined;
  try {
    const origin = execFileSync("git", ["remote", "get-url", "origin"], {
      cwd: checkout,
      encoding: "utf8",
    }).trim();
    fork = /github\.com[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?$/.exec(origin)?.[1];
  } catch {}
  return { checkout, fork };
}

export const rendererConfig = {
  worker: { format: "es", rolldownOptions: { output: { banner: licenceBanner } } },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "desktop-development-csp",
      apply: "serve",
      transformIndexHtml(html) {
        return html
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
          .replace("connect-src 'self'", "connect-src 'self' ws://127.0.0.1:5173");
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
  build: {
    rolldownOptions: {
      output: {
        banner: (chunk) => bundleLicenseBannerForInputs(Object.keys(chunk.modules)),
      },
    },
  },
} satisfies import("vite").UserConfig;

export default defineConfig({
  main: {
    define: { __TIDY_BUILD_SOURCE__: JSON.stringify(buildSource()) },
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        input: {
          index: fileURLToPath(new URL("./src/main/index.ts", import.meta.url)),
          "cloud-compute-worker": fileURLToPath(
            new URL("./src/main/cloud-compute-worker.ts", import.meta.url),
          ),
        },
        output: { banner: licenceBanner },
      },
    },
  },
  preload: {
    build: {
      externalizeDeps: false,
      rolldownOptions: {
        output: { format: "cjs", entryFileNames: "index.cjs", banner: licenceBanner },
      },
    },
  },
  renderer: rendererConfig,
});
