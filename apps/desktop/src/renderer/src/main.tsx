import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastViewport } from "@tidy/ui/toast";
import "@tidy/ui/toast.css";
import { App } from "./app/app";
import { HarnessUpdateNotices } from "./features/harnesses/harness-updates";
import { AppUpdateNotice } from "./features/updates/app-update";
import "@tidy/ui/fonts.css";
import "./styles.css";

if (import.meta.env.DEV && !window.tidy) await import("./platform/browser-api");

// Apply the native controls' inset before the first render to avoid a layout shift.
if (window.tidy?.customTitlebar) document.documentElement.dataset.titlebar = "hidden";
window.tidy?.onWindowFullscreen?.((fullscreen) => {
  document.documentElement.toggleAttribute("data-window-fullscreen", fullscreen);
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
    <ToastViewport>
      <AppUpdateNotice api={window.tidy} />
      <HarnessUpdateNotices api={window.tidy} />
    </ToastViewport>
  </StrictMode>,
);
