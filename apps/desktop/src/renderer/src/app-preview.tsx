import { memo, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@tidy/ui/button";
import type { DesktopAPI } from "../../shared/contracts";
import { localPreviewURL } from "../../shared/app-preview";

export const AppPreview = memo(function AppPreview({
  api,
  url,
  active,
  onURL,
}: {
  api: DesktopAPI;
  url?: string;
  active: boolean;
  onURL(url: string): void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [address, setAddress] = useState(url ?? "http://localhost:3000");
  const [error, setError] = useState<string>();
  const [supported, setSupported] = useState(true);
  const [loading, setLoading] = useState(false);
  const generation = useRef(0);
  const previous = useRef("");
  const sync = useCallback(
    (reload = false) => {
      const element = container.current;
      const bounds = element?.getBoundingClientRect();
      const obscured = document.querySelector("[popover]:popover-open, dialog[open]");
      const visible = Boolean(
        active && url && bounds && bounds.width > 0 && bounds.height > 0 && !obscured,
      );
      const request = visible
        ? {
            visible: true as const,
            url: url!,
            bounds: {
              x: Math.max(0, Math.round(bounds!.x)),
              y: Math.max(0, Math.round(bounds!.y)),
              width: Math.max(1, Math.round(bounds!.width)),
              height: Math.max(1, Math.round(bounds!.height)),
            },
            ...(reload ? { reload: true } : {}),
          }
        : { visible: false as const };
      const key = JSON.stringify(request);
      if (!reload && key === previous.current) return;
      previous.current = key;
      const version = ++generation.current;
      if (visible) {
        setLoading(true);
        setError(undefined);
      }
      void api
        .setAppPreview(request)
        .then((value) => {
          if (version === generation.current && visible) {
            setSupported(value);
            setLoading(false);
          }
        })
        .catch((cause) => {
          if (version === generation.current && visible) {
            setError(cause instanceof Error ? cause.message : "Could not open the app preview.");
            setLoading(false);
          }
        });
    },
    [api, active, url],
  );
  useEffect(() => {
    previous.current = "";
    sync();
    const observer = new ResizeObserver(() => sync());
    if (container.current) observer.observe(container.current);
    const toggle = () => sync();
    const modal = new MutationObserver(toggle);
    modal.observe(document.body, { attributes: true, subtree: true, attributeFilter: ["open"] });
    document.addEventListener("toggle", toggle, true);
    window.addEventListener("resize", toggle);
    return () => {
      generation.current++;
      observer.disconnect();
      modal.disconnect();
      document.removeEventListener("toggle", toggle, true);
      window.removeEventListener("resize", toggle);
      void api.setAppPreview({ visible: false }).catch(() => {});
    };
  }, [api, sync]);
  return (
    <div className="app-preview-surface">
      <form
        className="app-preview-address"
        onSubmit={(event) => {
          event.preventDefault();
          try {
            const value = localPreviewURL(address.trim());
            if (new URL(value).origin === location.origin)
              throw new Error("Use a different port from Tidy for your app preview.");
            setAddress(value);
            setError(undefined);
            if (value === url) sync(true);
            else onURL(value);
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : "Enter a localhost app URL.");
          }
        }}
      >
        <input
          aria-label="App preview URL"
          type="url"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder="http://localhost:3000"
          required
          maxLength={2048}
        />
        <Button type="submit" className="secondary-button">
          {url && address === url ? "Reload" : "Open preview"}
        </Button>
      </form>
      <div ref={container} className="app-preview-browser" aria-label="Running app preview">
        {!url ? (
          <p>Enter your running app’s localhost URL to preview it beside this thread.</p>
        ) : error ? (
          <div role="status">
            <p>{error}</p>
            <Button className="secondary-button" onClick={() => sync(true)}>
              Retry
            </Button>
          </div>
        ) : !supported ? (
          <p>
            Embedded previews are available in the desktop app.{" "}
            <a href={url} target="_blank" rel="noopener noreferrer">
              Open app in browser
            </a>
          </p>
        ) : loading ? (
          <p role="status">Opening app…</p>
        ) : null}
      </div>
    </div>
  );
});
