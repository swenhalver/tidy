import { expect, test } from "bun:test";
import {
  AppUpdates,
  compareAppVersions,
  latestDesktopRelease,
  upstreamReviewPrompt,
  type ForkInfo,
} from "./app-updates";
import type { AppUpdateState } from "../../shared/contracts/app-updates";

const base = "2bb06c13d125594c60e1bc40c893cae2ef2ab82a";
const fork: ForkInfo = {
  repository: "tidydesigns/tidy",
  commit: base,
  checkout: "/Users/designer/Projects/Tidy fork",
  fork: "designer/tidy",
};

/** Build a synthetic upstream desktop release. */
function release(version = "0.1.0-beta.12") {
  return {
    tag_name: `desktop-v${version}`,
    draft: false,
    prerelease: version.includes("-beta."),
  };
}

/** Inject fake GitHub responses so updater tests never use the network. */
function fixture(
  overrides: Partial<ConstructorParameters<typeof AppUpdates>[0]> = {},
  comparison: { status: string; ahead_by: number } = { status: "ahead", ahead_by: 37 },
) {
  const urls: string[] = [];
  const updater = new AppUpdates({
    supported: true,
    version: "0.1.0-beta.1",
    fork,
    fetch: async (url) => {
      urls.push(url);
      return new Response(
        JSON.stringify(url.includes("/compare/") ? comparison : [release("0.1.0-beta.12")]),
      );
    },
    ...overrides,
  });
  return { updater, urls };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test("version comparison handles numeric betas, stable promotion and base versions", () => {
  for (const [newer, older] of [
    ["0.1.0-beta.12", "0.1.0-beta.9"],
    ["0.1.0", "0.1.0-beta.12"],
    ["0.2.0-beta.1", "0.1.0"],
    ["1.0.0", "0.99.99"],
  ]) {
    expect(compareAppVersions(newer, older)).toBeGreaterThan(0);
    expect(compareAppVersions(older, newer)).toBeLessThan(0);
    expect(compareAppVersions(newer, newer)).toBe(0);
  }
  expect(() => compareAppVersions("0.1.0-rc.1", "0.1.0")).toThrow();
});

test("the newest desktop release wins regardless of publication order", () => {
  expect(latestDesktopRelease([release("0.1.0-beta.12"), release("0.1.0-beta.9")])).toEqual({
    version: "0.1.0-beta.12",
    tag: "desktop-v0.1.0-beta.12",
  });
  expect(latestDesktopRelease([release("0.1.0"), release("0.2.0-beta.1")])?.version).toBe(
    "0.2.0-beta.1",
  );
  expect(latestDesktopRelease([])).toBeNull();
});

test("drafts, unrelated tags and mismatched prerelease flags are ignored", () => {
  for (const change of ["draft", "tag", "channel", "version"]) {
    const value = release();
    if (change === "draft") value.draft = true;
    if (change === "tag") value.tag_name = "v0.1.0-beta.12";
    if (change === "channel") value.prerelease = false;
    if (change === "version") value.tag_name = "desktop-v0.1.0-rc.1";
    expect(latestDesktopRelease([value])).toBeNull();
  }
});

test("a release with unimported upstream commits is announced once, without downloading", async () => {
  const { updater, urls } = fixture();
  const states: AppUpdateState[] = [];
  updater.subscribe((state) => states.push(state));
  updater.start();
  try {
    await tick();
    expect(updater.state).toEqual({
      status: "available",
      version: "0.1.0-beta.12",
      tag: "desktop-v0.1.0-beta.12",
      commits: 37,
    });
    await updater.check();
    expect(urls).toEqual([
      "https://api.github.com/repos/tidydesigns/tidy/releases?per_page=100&page=1",
      `https://api.github.com/repos/tidydesigns/tidy/compare/${base}...desktop-v0.1.0-beta.12?per_page=1`,
      "https://api.github.com/repos/tidydesigns/tidy/releases?per_page=100&page=1",
    ]);
    expect(states.map((state) => state.status)).toEqual(["available", "available"]);
  } finally {
    updater.stop();
  }
});

test("releases the fork already contains stay quiet", async () => {
  for (const status of ["behind", "identical"]) {
    const { updater } = fixture({}, { status, ahead_by: 0 });
    updater.start();
    await tick();
    expect(updater.state).toEqual({ status: "idle" });
    expect(() => updater.prompt()).toThrow("No upstream update");
    updater.stop();
  }
});

test("without a recorded upstream commit, newer versions are announced", async () => {
  for (const [version, expected] of [
    ["0.1.0-beta.1", "available"],
    ["0.1.0-beta.12", "idle"],
  ]) {
    const { updater, urls } = fixture({ version, fork: { repository: "tidydesigns/tidy" } });
    updater.start();
    await tick();
    expect(updater.state.status).toBe(expected as AppUpdateState["status"]);
    expect(updater.state.commits).toBeUndefined();
    expect(urls.some((url) => url.includes("/compare/"))).toBe(false);
    updater.stop();
  }
});

test("the review prompt names the release, compare range, fork and safeguards", async () => {
  const { updater } = fixture();
  updater.start();
  try {
    await tick();
    const prompt = updater.prompt();
    expect(prompt).toContain("Tidy desktop 0.1.0-beta.12 (tag desktop-v0.1.0-beta.12)");
    expect(prompt).toContain(
      `https://github.com/tidydesigns/tidy/compare/${base}...desktop-v0.1.0-beta.12`,
    );
    expect(prompt).toContain("37 commits ahead");
    expect(prompt).toContain("/Users/designer/Projects/Tidy fork (GitHub: designer/tidy)");
    expect(prompt).toContain("apps/desktop/upstream.json");
    expect(prompt).toContain("Wait for my go-ahead");
  } finally {
    updater.stop();
  }
  expect(
    upstreamReviewPrompt(
      { repository: "tidydesigns/tidy" },
      { version: "0.2.0", tag: "desktop-v0.2.0" },
    ),
  ).toContain("git merge-base");
});

test("network failures and malformed responses keep the last known state quietly", async () => {
  let mode: "ok" | "offline" | "malformed" = "offline";
  const { updater } = fixture({
    fetch: async (url) => {
      if (mode === "offline") throw new Error("private/path secret");
      if (mode === "malformed") return new Response(JSON.stringify({ unexpected: "payload" }));
      return new Response(
        JSON.stringify(url.includes("/compare/") ? { status: "ahead", ahead_by: 2 } : [release()]),
      );
    },
  });
  updater.start();
  try {
    await tick();
    expect(updater.state).toEqual({ status: "idle" });
    mode = "ok";
    await updater.check();
    expect(updater.state.status).toBe("available");
    for (const failure of ["offline", "malformed"] as const) {
      mode = failure;
      await updater.check();
      expect(updater.state).toMatchObject({ status: "available", commits: 2 });
    }
  } finally {
    updater.stop();
  }
});

test("discovery scans later pages for a higher release", async () => {
  const { updater, urls } = fixture({
    fetch: async (url) => {
      urls.push(url);
      if (url.includes("/compare/"))
        return new Response(JSON.stringify({ status: "ahead", ahead_by: 1 }));
      return new Response(
        JSON.stringify(
          url.endsWith("page=1")
            ? [release("0.1.0"), ...Array.from({ length: 99 }, () => release("0.1.0-beta.1"))]
            : [release("0.2.0-beta.1")],
        ),
      );
    },
  });
  updater.start();
  try {
    await tick();
    expect(urls.filter((url) => url.includes("/releases?")).length).toBe(2);
    expect(updater.state.version).toBe("0.2.0-beta.1");
  } finally {
    updater.stop();
  }
});

test("conditional discovery reuses each page on 304 and detects changed releases", async () => {
  let round = 0;
  const requests: (string | null)[] = [];
  const { updater } = fixture({
    fetch: async (url, init) => {
      if (url.includes("/compare/"))
        return new Response(JSON.stringify({ status: "ahead", ahead_by: 1 }));
      const page = url.endsWith("page=1") ? 1 : 2;
      requests.push(new Headers(init.headers).get("if-none-match"));
      if (round === 1 || (round === 2 && page === 1)) return new Response(null, { status: 304 });
      const releases =
        page === 1
          ? Array.from({ length: 100 }, () => release("0.1.0-beta.1"))
          : [release(round === 2 ? "0.2.0-beta.1" : "0.1.0-beta.12")];
      return new Response(JSON.stringify(releases), { headers: { etag: `"page-${page}"` } });
    },
  });
  updater.start();
  try {
    await tick();
    expect(updater.state.version).toBe("0.1.0-beta.12");
    round = 1;
    await updater.check();
    expect(updater.state.version).toBe("0.1.0-beta.12");
    round = 2;
    await updater.check();
    expect(updater.state.version).toBe("0.2.0-beta.1");
    expect(requests).toEqual([null, null, '"page-1"', '"page-2"', '"page-1"', '"page-2"']);
  } finally {
    updater.stop();
  }
});

test("rate limits stay quiet, honor retry deadlines and block manual retry storms", async () => {
  const initial = 1_800_000_000_000;
  const delay = 2 * 60 * 60 * 1000;
  const deadline = initial + delay + 60_000;
  for (const endpoint of ["/releases?", "/compare/"]) {
    for (const status of [403, 429]) {
      let now = initial;
      let limited = 0;
      const { updater } = fixture({
        now: () => now,
        fetch: async (url) => {
          if (url.includes(endpoint) && limited++ === 0)
            return new Response(null, {
              status,
              headers: {
                "x-ratelimit-remaining": "0",
                "x-ratelimit-reset": String(deadline / 1000),
              },
            });
          return new Response(
            JSON.stringify(
              url.includes("/compare/") ? { status: "ahead", ahead_by: 3 } : [release()],
            ),
          );
        },
      });
      updater.start();
      try {
        await tick();
        expect(updater.state).toEqual({ status: "idle" });
        now += delay;
        await updater.check();
        expect(limited).toBe(1);
        now += 60_000;
        await updater.check();
        expect(updater.state).toMatchObject({ status: "available", commits: 3 });
      } finally {
        updater.stop();
      }
    }
  }
});

test("development and unsupported packages never check", async () => {
  const { updater, urls } = fixture({ supported: false });
  updater.start();
  await updater.check();
  expect(updater.state.status).toBe("unsupported");
  expect(urls).toEqual([]);
  expect(() => updater.prompt()).toThrow();
  updater.stop();
});

test("shutdown during a check cannot publish a stale notice", async () => {
  let respond!: (response: Response) => void;
  const states: AppUpdateState[] = [];
  const { updater } = fixture({
    fetch: () =>
      new Promise((resolve) => {
        respond = resolve;
      }),
  });
  updater.subscribe((state) => states.push(state));
  updater.start();
  updater.stop();
  respond(new Response(JSON.stringify([release()])));
  await tick();
  expect(states).toEqual([]);
  expect(updater.state.status).toBe("idle");
});
