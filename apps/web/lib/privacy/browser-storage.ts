export function clearAnalyticsStorage() {
  // Also remove cookies from the SDK's former parent-domain persistence.
  try {
    const names = document.cookie
      .split(";")
      .map((part) => part.trim().split("=")[0])
      .filter((name) => name.startsWith("ph_"));
    const hostParts = location.hostname.split(".");
    for (const name of names) {
      document.cookie = `${name}=; Path=/; Max-Age=0`;
      for (let index = 0; index < hostParts.length - 1; index++) {
        document.cookie = `${name}=; Path=/; Max-Age=0; Domain=.${hostParts.slice(index).join(".")}`;
      }
    }
  } catch {
    /* Cookie access may be disabled; storage cleanup and the app must still work. */
  }
  for (const storage of [() => localStorage, () => sessionStorage]) {
    try {
      const store = storage();
      for (const name of Object.keys(store)) if (name.startsWith("ph_")) store.removeItem(name);
    } catch {
      /* Storage may be disabled. */
    }
  }
}
