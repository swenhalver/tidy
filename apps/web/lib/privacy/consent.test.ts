import { expect, spyOn, test } from "bun:test";
import { readConsent, CONSENT_MAX_AGE } from "@tidy/ui/consent";
import { createErrorReporter, analyticsIdentity } from "../posthog-server";
import { createRequestTrace } from "../request-tracing";
const cookie = (value: unknown) => `tidy_consent=${encodeURIComponent(JSON.stringify(value))}`;
test("only current, explicit and valid consent enables analytics", () => {
  const now = Date.now();
  for (const value of [
    null,
    {},
    true,
    { version: 2, analytics: true, updatedAt: now },
    { version: 1, analytics: "true", updatedAt: now },
    { version: 1, analytics: true, updatedAt: now + 1 },
    { version: 1, analytics: true, updatedAt: now - CONSENT_MAX_AGE * 1000 },
  ])
    expect(readConsent(cookie(value), now)).toBeNull();
  expect(readConsent("tidy_consent=%bad", now)).toBeNull();
  expect(
    readConsent(cookie({ version: 1, analytics: false, updatedAt: now }), now)?.analytics,
  ).toBe(false);
  expect(readConsent(cookie({ version: 1, analytics: true, updatedAt: now }), now)?.analytics).toBe(
    true,
  );
});
test("absent, rejected and expired consent causes no server analytics I/O or identity correlation", async () => {
  const transport = spyOn(globalThis, "fetch").mockRejectedValue(
    new Error("Unexpected analytics request"),
  );
  try {
    for (const consent of [
      "",
      cookie({ version: 1, analytics: false, updatedAt: Date.now() }),
      cookie({ version: 1, analytics: true, updatedAt: 1 }),
    ]) {
      const headers = new Headers({
        cookie: `${consent}; ph_test_posthog=${encodeURIComponent('{"distinct_id":"private-person"}')}`,
      });
      expect(analyticsIdentity(headers, "test")).toBeUndefined();
      await createErrorReporter(headers, { key: "test", host: "https://analytics.invalid" })(
        new Error("private"),
        { source: "next", event: "failure" },
      );
      const trace = createRequestTrace(new Request("https://app.test/", { headers }), {
        key: "test",
        host: "https://analytics.invalid",
      });
      trace.finish("request_completed", 200);
    }
    expect(transport).not.toHaveBeenCalled();
  } finally {
    transport.mockRestore();
  }
});
