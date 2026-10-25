/**
 * Sign the locally packaged app with an Apple Development identity, so every
 * rebuild keeps the same code identity and macOS permissions granted to Tidy
 * persist. Uses the release signing options without notarization; for this
 * Mac only, not for distribution. Run after `bun run package:desktop`.
 */
import { sign } from "@electron/osx-sign";
import { execFile } from "node:child_process";
import { closeSync, openSync, readSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import manifest from "../package.json";

const execute = promisify(execFile);
const appDirectory = fileURLToPath(new URL("..", import.meta.url));
const app = join(appDirectory, "release", `Tidy-darwin-${process.arch}`, "Tidy.app");

if (process.platform !== "darwin") throw new Error("Local signing requires macOS.");

/** Use TIDY_LOCAL_SIGN_IDENTITY, or the Mac's only Apple Development identity. */
async function signingIdentity() {
  const configured = process.env.TIDY_LOCAL_SIGN_IDENTITY?.trim();
  if (configured) return configured;
  const { stdout } = await execute("security", ["find-identity", "-v", "-p", "codesigning"]);
  const identities = [...stdout.matchAll(/"(Apple Development: [^"]+)"/g)].map((match) => match[1]);
  if (identities.length !== 1)
    throw new Error(
      "Set TIDY_LOCAL_SIGN_IDENTITY to one Apple Development identity from `security find-identity -v -p codesigning`.",
    );
  return identities[0];
}

/** Copied from release-mac.ts, which runs a release on import: skip non-Mach-O files. */
function isResource(path: string) {
  if (!statSync(path).isFile()) return false;
  const descriptor = openSync(path, "r");
  try {
    const header = Buffer.alloc(4);
    if (readSync(descriptor, header, 0, 4, 0) !== 4) return true;
    return ![
      0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf,
      0xbfbafeca,
    ].includes(header.readUInt32BE());
  } finally {
    closeSync(descriptor);
  }
}

const identity = await signingIdentity();
console.info(`Signing ${app} as ${identity}…`);
// packageDesktop applies the security fuses first; signing must be the final bundle mutation.
await sign({
  app,
  identity,
  platform: "darwin",
  version: manifest.devDependencies.electron,
  preEmbedProvisioningProfile: false,
  ignore: isResource,
  optionsForFile: () => ({
    hardenedRuntime: true,
    entitlements: ["com.apple.security.cs.allow-jit"],
  }),
});
await execute("codesign", ["--verify", "--deep", "--strict", app]);
console.info("Signed. Not notarized: run it on this Mac only.");
