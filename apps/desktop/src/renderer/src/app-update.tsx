import { useEffect, useState } from "react";
import { Button } from "@tidy/ui/button";
import { Icon } from "@tidy/editor/components/ui/icon";
import type { DesktopAPI } from "../../shared/contracts";
import type { AppUpdateState } from "../../shared/app-updates";

const dismissedKey = "tidy:upstream-update-dismissed";

/** Read the dismissed release without making unavailable browser storage a rendering failure. */
function dismissedVersion() {
  try {
    return localStorage.getItem(dismissedKey);
  } catch {
    return null;
  }
}

/** Announce a newer upstream release with a prompt for reviewing it before import. */
export function AppUpdateNotice({ api }: { api: DesktopAPI | undefined }) {
  const [state, setState] = useState<AppUpdateState>({ status: "unsupported" });
  const [dismissed, setDismissed] = useState(dismissedVersion);
  const [copy, setCopy] = useState<"idle" | "copied" | "error">("idle");
  useEffect(() => {
    if (!api) return;
    let received = false;
    let active = true;
    const unsubscribe = api.onUpdate((value) => {
      received = true;
      setState(value);
    });
    void api
      .updateState()
      .then((value) => {
        if (active && !received) setState(value);
      })
      .catch(() => {});
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api]);
  useEffect(() => {
    if (copy !== "copied") return;
    const timer = window.setTimeout(() => setCopy("idle"), 2000);
    return () => window.clearTimeout(timer);
  }, [copy]);

  if (state.status !== "available" || !state.version || dismissed === state.version) return null;
  const version = state.version;
  const detail =
    state.commits === undefined
      ? "Upstream release"
      : `${state.commits} upstream commit${state.commits === 1 ? "" : "s"} to review`;
  return (
    <section
      className="tidy-toast harness-update-notice"
      aria-label="Upstream update"
      data-canvas-control
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <header className="harness-update-header">
        <span>Upstream update</span>
        <Button
          className="harness-update-dismiss"
          aria-label={`Dismiss Tidy ${version}`}
          onClick={() => {
            setDismissed(version);
            try {
              localStorage.setItem(dismissedKey, version);
            } catch {}
          }}
        >
          <Icon name="xmark" size={14} />
        </Button>
      </header>
      <div className="harness-update-row app-update-row">
        <span className="harness-update-mark">
          <Icon name="update" size={18} />
        </span>
        <div className="harness-update-copy">
          <span className="harness-update-name">Tidy {version}</span>
          <span className="harness-update-detail">{detail}</span>
        </div>
        <Button
          className="harness-update-install"
          aria-label={
            copy === "copied"
              ? `Copied review prompt for Tidy ${version}`
              : `Copy review prompt for Tidy ${version}`
          }
          onClick={() => {
            if (!api) return;
            setCopy("copied");
            void api.copyUpdatePrompt().catch(() => setCopy("error"));
          }}
        >
          {copy === "copied" ? (
            <>
              <Icon name="check" size={14} /> Copied
            </>
          ) : (
            <>
              <Icon name="copy" size={14} /> Copy prompt
            </>
          )}
        </Button>
        <p className="harness-update-error" role={copy === "error" ? "alert" : "status"}>
          {copy === "error"
            ? "Couldn’t copy the prompt. Try again."
            : "Paste it into a new T3 chat to review the changes for your fork."}
        </p>
      </div>
    </section>
  );
}
