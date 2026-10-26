import { z } from "zod";
import type { AppUpdateState } from "../../shared/contracts/app-updates";

const interval = 30 * 60 * 1000;
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-beta\.([1-9]\d*))?$/;
const releasesSchema = z
  .array(z.object({ tag_name: z.string(), draft: z.boolean(), prerelease: z.boolean() }))
  .max(100);
const compareSchema = z.object({
  status: z.enum(["ahead", "behind", "identical", "diverged"]),
  ahead_by: z.number().int().min(0),
});
type Release = z.infer<typeof releasesSchema>[number];
type Candidate = { version: string; tag: string };

/** Where this build came from, recorded at build time for the review prompt. */
export type ForkInfo = {
  /** Upstream GitHub repository, such as tidydesigns/tidy. */
  repository: string;
  /** Upstream commit the fork last imported, from apps/desktop/upstream.json. */
  commit?: string;
  /** Local checkout the app was built from. */
  checkout?: string;
  /** The fork's own GitHub repository, from the checkout's origin remote. */
  fork?: string;
};

/** Parse supported release versions, rejecting noncanonical or unsafe numeric components. */
function parts(version: string) {
  const match = versionPattern.exec(version);
  if (!match) return null;
  const values = match.slice(1, 4).map(Number);
  const beta = match[4] === undefined ? null : Number(match[4]);
  return [...values, ...(beta === null ? [] : [beta])].every(Number.isSafeInteger)
    ? { values, beta }
    : null;
}

/** Compare only the canonical stable/numbered-beta versions our release pipeline produces. */
export function compareAppVersions(left: string, right: string) {
  const a = parts(left),
    b = parts(right);
  if (!a || !b) throw new Error("Unsupported desktop version.");
  for (let index = 0; index < 3; index++) {
    if (a.values[index] !== b.values[index]) return a.values[index] - b.values[index];
  }
  if (a.beta === b.beta) return 0;
  if (a.beta === null) return 1;
  if (b.beta === null) return -1;
  return a.beta - b.beta;
}

/** The newest published upstream desktop release, betas included, in any publication order. */
export function latestDesktopRelease(releases: Release[]): Candidate | null {
  let selected: Candidate | null = null;
  for (const release of releases) {
    const version = release.tag_name.replace(/^desktop-v/, "");
    if (!release.tag_name.startsWith("desktop-v") || !parts(version) || release.draft) continue;
    if (release.prerelease !== (parts(version)!.beta !== null)) continue;
    if (selected && compareAppVersions(version, selected.version) <= 0) continue;
    selected = { version, tag: release.tag_name };
  }
  return selected;
}

/** A prompt for a new T3 Code chat that reviews upstream changes before importing them. */
export function upstreamReviewPrompt(
  fork: ForkInfo,
  update: { version: string; tag: string; commits?: number },
) {
  const upstream = `https://github.com/${fork.repository}`;
  const range = fork.commit ? `${fork.commit}...${update.tag}` : update.tag;
  return [
    `Review upstream Tidy changes for import into my fork. Upstream (${upstream}) has released Tidy desktop ${update.version} (tag ${update.tag}).`,
    "",
    `- My fork: ${fork.checkout ?? "my Tidy fork checkout"}${fork.fork ? ` (GitHub: ${fork.fork})` : ""}.`,
    fork.commit
      ? `- Last imported upstream commit: ${fork.commit}, recorded in apps/desktop/upstream.json. ${update.commits ? `Upstream is ${update.commits} commit${update.commits === 1 ? "" : "s"} ahead: ` : "Changes: "}${upstream}/compare/${range}`
      : `- The last imported upstream commit is not recorded. Find it with git merge-base against upstream/main.`,
    "- My fork's own changes are the commits on my current branch that are not in upstream/main.",
    "",
    "Please:",
    `1. Add or fetch the upstream remote and summarise the changes in ${range}, grouped by area: desktop app, editor and design packages, the web MCP and design code that apps/local-mcp bundles, build and release tooling, and dependencies.`,
    "2. Security-review them before anything is merged: dependency and lockfile changes (run bun audit), install scripts, network calls and telemetry, Electron hardening, IPC, child processes, update behaviour, and anything that would require a Tidy login for local use.",
    "3. Compare them with my fork's changes, including the Claude capability discovery isolation (apps/desktop/src/main/harnesses/harness-connection.ts), the local MCP (apps/local-mcp: its build and src/shims/contract.ts flag changed web modules), and this upstream update notice that replaces automatic updates (apps/desktop/src/main/app/app-updates.ts). List conflicts and anything that needs adapting.",
    "4. Recommend importing, partially importing or skipping, with reasons. Wait for my go-ahead before changing anything.",
    "5. If I approve: rebase my branch onto the release in a new worktree branch, keep my changes, update apps/desktop/upstream.json to the imported upstream commit, run the desktop and local MCP tests and type checks, rebuild the local MCP, repackage the desktop app and reinstall it as /Applications/Tidy Design (Paper alt).app.",
  ].join("\n");
}

export class AppUpdates {
  state: AppUpdateState;
  private listeners = new Set<(state: AppUpdateState) => void>();
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private checking = false;
  private pages = new Map<number, { etag: string; releases: Release[] }>();
  private comparisons = new Map<string, number>();
  private retryAt = 0;
  private rateLimitFailures = 0;

  constructor(
    private readonly options: {
      supported: boolean;
      version: string;
      fork: ForkInfo;
      fetch(url: string, init: RequestInit): Promise<Response>;
      now?(): number;
    },
  ) {
    this.state = { status: options.supported ? "idle" : "unsupported" };
  }

  private set(state: AppUpdateState) {
    if (this.stopped) return;
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }

  /** Observe subsequent sanitized states; the returned function removes this subscription. */
  subscribe(listener: (state: AppUpdateState) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Start immediate and periodic checks once for supported packages. */
  start() {
    if (this.state.status === "unsupported" || this.timer || this.stopped) return;
    this.timer = setInterval(() => void this.check(), interval);
    this.timer.unref();
    void this.check();
  }

  private request(path: string, etag?: string) {
    return this.options.fetch(
      `https://api.github.com/repos/${this.options.fork.repository}${path}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          ...(etag ? { "If-None-Match": etag } : {}),
        },
        signal: AbortSignal.timeout(20_000),
      },
    );
  }

  /** Conditional requests still share an unauthenticated IP's quota. Back off even when
   * GitHub omits retry headers, and prevent manual retries from bypassing it. */
  private rateLimited(response: Response) {
    if (response.status !== 403 && response.status !== 429) return false;
    const now = this.options.now?.() ?? Date.now();
    const retry = response.headers.get("retry-after");
    const retryAfter =
      retry === null ? 0 : /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry);
    const reset =
      response.headers.get("x-ratelimit-remaining") === "0"
        ? Number(response.headers.get("x-ratelimit-reset")) * 1000
        : 0;
    const backoff = interval * 2 ** Math.min(this.rateLimitFailures++, 5);
    this.retryAt = Math.max(
      now + backoff,
      Number.isFinite(retryAfter) ? retryAfter : 0,
      Number.isFinite(reset) ? reset : 0,
    );
    return true;
  }

  /** Count upstream commits in a release that the fork has not imported, once per tag. */
  private async aheadBy(candidate: Candidate) {
    const commit = this.options.fork.commit;
    if (!commit) return compareAppVersions(candidate.version, this.options.version) > 0 ? 0 : null;
    const cached = this.comparisons.get(candidate.tag);
    if (cached !== undefined) return cached;
    const response = await this.request(
      `/compare/${commit}...${encodeURIComponent(candidate.tag)}?per_page=1`,
    );
    if (this.rateLimited(response)) return undefined;
    if (!response.ok) throw new Error("Upstream comparison failed.");
    const comparison = compareSchema.parse(await response.json());
    const ahead = ["ahead", "diverged"].includes(comparison.status) ? comparison.ahead_by : 0;
    this.comparisons.set(candidate.tag, ahead);
    return ahead;
  }

  /** Discover upstream releases; never download or install anything. Failures stay quiet. */
  async check() {
    if (
      this.stopped ||
      this.checking ||
      this.state.status === "unsupported" ||
      (this.options.now?.() ?? Date.now()) < this.retryAt
    )
      return;
    this.checking = true;
    try {
      const discovered: Release[] = [];
      // Include prereleases and tolerate releases being published out of version order.
      for (let page = 1; page <= 3; page++) {
        const cached = this.pages.get(page);
        const response = await this.request(`/releases?per_page=100&page=${page}`, cached?.etag);
        if (this.rateLimited(response)) return;
        let releases: Release[];
        if (response.status === 304 && cached) releases = cached.releases;
        else {
          if (!response.ok) throw new Error("Release discovery failed.");
          releases = releasesSchema.parse(await response.json());
          const etag = response.headers.get("etag");
          if (etag) this.pages.set(page, { etag, releases });
          else this.pages.delete(page);
        }
        discovered.push(...releases);
        if (releases.length < 100) break;
      }
      const candidate = latestDesktopRelease(discovered);
      const ahead = candidate ? await this.aheadBy(candidate) : null;
      if (ahead === undefined || this.stopped) return;
      this.rateLimitFailures = 0;
      if (!candidate || ahead === null || (this.options.fork.commit && ahead === 0)) {
        this.set({ status: "idle" });
        return;
      }
      this.set({
        status: "available",
        version: candidate.version,
        tag: candidate.tag,
        ...(this.options.fork.commit ? { commits: ahead } : {}),
      });
    } catch {
      /* Offline or unexpected responses keep the last known state until the next check. */
    } finally {
      this.checking = false;
    }
  }

  /** The review prompt for the available release; the renderer never supplies its text. */
  prompt() {
    if (this.state.status !== "available" || !this.state.version || !this.state.tag)
      throw new Error("No upstream update is available.");
    return upstreamReviewPrompt(this.options.fork, {
      version: this.state.version,
      tag: this.state.tag,
      commits: this.state.commits,
    });
  }

  /** Permanently stop polling and notifications. */
  stop() {
    this.stopped = true;
    clearInterval(this.timer);
    this.listeners.clear();
  }
}
