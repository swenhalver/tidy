import { expect, test } from "bun:test";
import { appPreviewSchema, localPreviewURL } from "../shared/app-preview";

test("app previews accept only explicit loopback HTTP destinations and bounded native rectangles", () => {
  for (const url of ["http://localhost:3000", "https://127.0.0.1:8443/a?b=1", "http://[::1]:3000/"])
    expect(localPreviewURL(url)).toBe(new URL(url).href);
  for (const url of [
    "file:///etc/passwd",
    "tidy://app/index.html",
    "data:text/html,hi",
    "javascript:alert(1)",
    "https://example.com",
    "http://localhost.evil.test",
    "http://localhost@evil.test",
    "http://user:password@localhost",
    "http://192.168.0.1",
    "http://0.0.0.0",
    "http://localhost\\@evil.test",
  ])
    expect(() => localPreviewURL(url)).toThrow();
  expect(
    appPreviewSchema.safeParse({
      visible: true,
      url: "http://localhost:3000",
      bounds: { x: 0, y: 0, width: 600, height: 400 },
    }).success,
  ).toBe(true);
  for (const invalid of [NaN, Infinity, -1, 0, 20001, 1.2])
    expect(
      appPreviewSchema.safeParse({
        visible: true,
        url: "http://localhost:3000",
        bounds: { x: 0, y: 0, width: invalid, height: 400 },
      }).success,
    ).toBe(false);
  expect(appPreviewSchema.safeParse({ visible: false, url: "http://localhost:3000" }).success).toBe(
    false,
  );
});
