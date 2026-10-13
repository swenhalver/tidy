import { expect, test } from "bun:test";
import { setConsent } from "@tidy/ui/consent";

test("rejecting cookies clears legacy host and parent-domain analytics storage while preserving preferences", () => {
  const globals = ["document", "location", "window", "localStorage", "sessionStorage"] as const;
  const descriptors = globals.map((name) => Object.getOwnPropertyDescriptor(globalThis, name));
  const writes: string[] = [];
  const cookies = new Map([
    ["ph_legacy_posthog", "legacy-identity"],
    ["theme", "dark"],
  ]);
  const persistent: Record<string, unknown> = {
    ph_legacy_posthog: "legacy-identity",
    theme: "dark",
    removeItem(key: string) {
      delete persistent[key];
    },
    setItem(key: string, value: string) {
      persistent[key] = value;
    },
  };
  const session: Record<string, unknown> = {
    ph_session: "legacy-session",
    editor: "layout",
    removeItem(key: string) {
      delete session[key];
    },
  };
  const doc = {
    get cookie() {
      return [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    set cookie(value: string) {
      writes.push(value);
      const [pair] = value.split(";");
      const offset = pair.indexOf("=");
      const key = pair.slice(0, offset);
      if (value.includes("Max-Age=0")) cookies.delete(key);
      else cookies.set(key, pair.slice(offset + 1));
    },
  };
  try {
    for (const [name, value] of Object.entries({
      document: doc,
      location: { protocol: "https:", hostname: "app.example.test" },
      window: { dispatchEvent() {} },
      localStorage: persistent,
      sessionStorage: session,
    }))
      Object.defineProperty(globalThis, name, { configurable: true, value });
    setConsent(false);
    expect(persistent.ph_legacy_posthog).toBeUndefined();
    expect(session.ph_session).toBeUndefined();
    expect(persistent.theme).toBe("dark");
    expect(session.editor).toBe("layout");
    expect(cookies.get("theme")).toBe("dark");
    expect(writes).toContain("ph_legacy_posthog=; Path=/; Max-Age=0; Domain=.example.test");
    expect(JSON.parse(decodeURIComponent(cookies.get("tidy_consent")!)).analytics).toBe(false);
  } finally {
    globals.forEach((name, index) => {
      const descriptor = descriptors[index];
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    });
  }
});
