const siteHost = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://tidydesign.co").host;

export function SiteFooter() {
  return (
    <footer className="footer">
      <span>© 2026 Tidy</span>
      <nav className="footer-links" aria-label="Legal">
        <a href="/privacy">Privacy and cookies</a>
        <a href="/terms">Terms of service</a>
      </nav>
      <span>{siteHost}</span>
    </footer>
  );
}
