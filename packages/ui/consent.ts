export const CONSENT_COOKIE = "tidy_consent";
export const CONSENT_EVENT = "tidy:consent";
export const CONSENT_MAX_AGE = 60 * 60 * 24 * 180;
export type Consent = { version: 1; analytics: boolean; updatedAt: number };

export function readConsent(cookie: string, now = Date.now()): Consent | null {
  const value = cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${CONSENT_COOKIE}=`))
    ?.slice(CONSENT_COOKIE.length + 1);
  if (!value) return null;
  try {
    const consent = JSON.parse(decodeURIComponent(value));
    return consent?.version === 1 &&
      typeof consent.analytics === "boolean" &&
      Number.isFinite(consent.updatedAt) &&
      consent.updatedAt <= now &&
      now - consent.updatedAt < CONSENT_MAX_AGE * 1000
      ? consent
      : null;
  } catch {
    return null;
  }
}

export function analyticsAllowed() {
  return typeof document !== "undefined" && readConsent(document.cookie)?.analytics === true;
}

export function setConsent(analytics: boolean) {
  const consent: Consent = { version: 1, analytics, updatedAt: Date.now() };
  document.cookie = `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(consent))}; Path=/; Max-Age=${CONSENT_MAX_AGE}; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  if (!analytics) clearAnalyticsStorage();
  // Broadcast only a change notification, never an analytics identifier.
  try {
    localStorage.setItem(CONSENT_EVENT, String(consent.updatedAt));
  } catch {
    /* Storage may be blocked. */
  }
  window.dispatchEvent(new Event(CONSENT_EVENT));
}

// Remove legacy SDK persistence on rejection/deletion without loading the SDK
// or sending an opt-out event. Current app collection remains hard-paused.
function clearAnalyticsStorage() {
  const names = document.cookie
    .split(";")
    .map((part) => part.trim().split("=")[0])
    .filter((name) => name.startsWith("ph_"));
  const hostParts = location.hostname.split(".");
  for (const name of names) {
    document.cookie = `${name}=; Path=/; Max-Age=0`;
    for (let index = 0; index < hostParts.length - 1; index++)
      document.cookie = `${name}=; Path=/; Max-Age=0; Domain=.${hostParts.slice(index).join(".")}`;
  }
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try {
      const store = storage();
      for (const name of Object.keys(store)) if (name.startsWith("ph_")) store.removeItem(name);
    } catch {
      /* Storage may be blocked; rejection must still work. */
    }
  }
}
