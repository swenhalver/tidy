import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ToastViewport } from "@tidy/ui/toast";
import "@tidy/ui/toast.css";
import { App } from "./app";
import { DesignProvider } from "./design-context";
import "@tidy/ui/fonts.css";
import "./styles.css";

if (import.meta.env.DEV && !window.tidy) await import("./browser-api");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {window.tidy ? (
      <DesignProvider api={window.tidy}>
        <App />
      </DesignProvider>
    ) : (
      <div className="project-home">Open Tidy desktop to work with local projects.</div>
    )}
    <ToastViewport />
  </StrictMode>,
);
