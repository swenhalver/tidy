// Exercise the shipped pause in a browser with only synthetic local data.
import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
const root = resolve(import.meta.dirname, "..");
const fixture = resolve(root, ".artifacts/cookie-privacy-browser");
await mkdir(fixture, { recursive: true });
await Bun.write(
  `${fixture}/entry.tsx`,
  `
import React from "react";
import { createRoot } from "react-dom/client";
import "../../instrumentation-client";
import { CookieConsent } from "@tidy/ui/cookie-consent";
import { PrivacyNotice } from "@tidy/ui/privacy-notice";
import "@tidy/ui/privacy.css";
createRoot(document.getElementById("root")!).render(<>
  {location.pathname === "/privacy" ? <PrivacyNotice controller="Fixture operator" contact="privacy@example.invalid" accountUrl="/account/privacy" /> : <main><h1>Fixture app</h1></main>}
  <CookieConsent analyticsPaused />
</>);`,
);
const build = await Bun.build({
  entrypoints: [`${fixture}/entry.tsx`],
  target: "browser",
  outdir: fixture,
});
assert.ok(build.success, String(build.logs));
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/entry.js" || path === "/entry.css")
      return new Response(Bun.file(fixture + path));
    return new Response(
      '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Privacy fixture</title><link rel="stylesheet" href="/entry.css"><style>html{color-scheme:light dark}</style></head><body><div id="root"></div><script type="module" src="/entry.js"></script></body></html>',
      { headers: { "Content-Type": "text/html" } },
    );
  },
});
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const external = [],
    errors = [];
  page.on("request", (request) => {
    if (new URL(request.url()).origin !== server.url.origin) external.push(request.url());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  const dialog = page.getByRole("dialog", { name: "Your privacy choices" });
  const settings = page.getByRole("button", { name: "Cookie settings", exact: true });
  await page.goto(server.url.href);
  await dialog.waitFor();
  assert.equal(await page.getByRole("button", { name: "Accept analytics cookies" }).count(), 0);
  assert.match(await dialog.textContent(), /analytics is currently paused/);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await settings.evaluate((e) => e === document.activeElement), true);
  assert.equal(await page.evaluate(() => document.cookie.includes("tidy_consent=")), false);
  // An existing auth session is independent from cookie preference state.
  await page.evaluate(() => {
    document.cookie = "fixture_auth=keep; Path=/";
    document.cookie = "ph_fixture_posthog=old; Path=/";
    localStorage.setItem("ph_fixture_posthog", "old");
    sessionStorage.setItem("ph_fixture_posthog", "old");
    localStorage.setItem("fixture_theme", "dark");
  });
  await page.reload();
  await dialog.waitFor();
  assert.deepEqual(
    await page.evaluate(() => ({
      legacy:
        document.cookie.includes("ph_fixture") ||
        localStorage.getItem("ph_fixture_posthog") !== null ||
        sessionStorage.getItem("ph_fixture_posthog") !== null,
      auth: document.cookie.includes("fixture_auth=keep"),
      theme: localStorage.getItem("fixture_theme"),
    })),
    { legacy: false, auth: true, theme: "dark" },
  );
  await page.getByRole("button", { name: "Use essential cookies only" }).click();
  await page.reload();
  await settings.waitFor();
  assert.equal(await dialog.count(), 0);
  await settings.click();
  await dialog.waitFor();
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    await page.setViewportSize({ width: 320, height: 640 });
    assert.equal(
      await dialog.evaluate((e) => e.scrollWidth <= e.clientWidth),
      true,
      "Dialog has no horizontal overflow at 320 CSS pixels",
    );
    assert.equal(
      await dialog.evaluate((e) => {
        const r = e.getBoundingClientRect();
        return r.left >= 0 && r.right <= innerWidth;
      }),
      true,
    );
    for (const button of await dialog.getByRole("button").all())
      assert.ok((await button.boundingBox()).height >= 44);
  }
  // Invalid, expired and unknown-version preferences prompt again. A previously
  // positive valid preference never overrides the collection pause.
  for (const value of [
    "%bad",
    encodeURIComponent(JSON.stringify({ version: 1, analytics: true, updatedAt: 1 })),
    encodeURIComponent(JSON.stringify({ version: 999, analytics: true, updatedAt: Date.now() })),
  ]) {
    await page.evaluate((value) => {
      document.cookie = `tidy_consent=${value}; Path=/`;
    }, value);
    await page.reload();
    await dialog.waitFor();
    assert.equal(await page.getByRole("button", { name: "Accept analytics cookies" }).count(), 0);
  }
  await page.evaluate(() => {
    document.cookie = `tidy_consent=${encodeURIComponent(JSON.stringify({ version: 1, analytics: true, updatedAt: Date.now() }))}; Path=/`;
  });
  await page.reload();
  await settings.waitFor();
  assert.equal(await dialog.count(), 0);
  await settings.click();
  assert.match(await dialog.textContent(), /No PostHog tracking is active/);
  await page.evaluate(() => {
    document.cookie = "tidy_consent=; Path=/; Max-Age=0";
  });
  await page.goto(new URL("/privacy", server.url).href);
  await page.getByRole("heading", { name: "Privacy and cookies" }).waitFor();
  assert.equal(
    await dialog.count(),
    0,
    "The privacy notice is readable without first dismissing consent UI",
  );
  assert.match(await page.getByRole("main").textContent(), /currently paused/);
  assert.deepEqual(external, [], "No PostHog SDK or collection request in any consent state");
  assert.deepEqual(errors, []);
  console.info(
    "PASS: new/returning visitors, essential preference persistence, stale preferences, Escape/focus, legacy storage cleanup, light/dark 320px layout, readable privacy notice and zero PostHog traffic.",
  );
} finally {
  await browser?.close();
  server.stop(true);
  await rm(fixture, { recursive: true, force: true });
}
