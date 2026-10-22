import { BrowserWindow, WebContentsView, session } from "electron";
import { localPreviewURL, type AppPreviewRequest } from "../shared/app-preview";

type Preview = {
  view: WebContentsView;
  url: string;
  bounds: Electron.Rectangle;
  generation: number;
  loading?: Promise<void>;
};

/** One isolated development browser per workspace window; it never receives an app preload. */
export class AppPreviews {
  private previews = new Map<number, Preview>();
  constructor(private rendererURL: string) {}

  async set(window: BrowserWindow, request: AppPreviewRequest) {
    let preview = this.previews.get(window.id);
    if (!request.visible) {
      preview?.view.setVisible(false);
      return true;
    }
    const url = localPreviewURL(request.url);
    if (new URL(url).origin === new URL(this.rendererURL).origin)
      throw new Error("Preview your app on a different port from the Tidy renderer.");
    if (!preview) {
      const isolated = session.fromPartition(`tidy-preview-${window.id}`);
      isolated.setPermissionRequestHandler((_contents, _permission, answer) => answer(false));
      isolated.setPermissionCheckHandler(() => false);
      isolated.on("will-download", (event) => event.preventDefault());
      const view = new WebContentsView({
        webPreferences: {
          session: isolated,
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
          webSecurity: true,
          webviewTag: false,
        },
      });
      preview = { view, url: "", bounds: request.bounds, generation: 0 };
      this.previews.set(window.id, preview);
      window.contentView.addChildView(view);
      view.setVisible(false);
      view.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      const allow = (target: string) => {
        try {
          return new URL(localPreviewURL(target)).origin === new URL(preview!.url).origin;
        } catch {
          return false;
        }
      };
      view.webContents.on("will-navigate", (event, target) => {
        if (!allow(target)) event.preventDefault();
      });
      view.webContents.on("will-redirect", (event, target) => {
        if (!allow(target)) event.preventDefault();
      });
      view.webContents.on("will-frame-navigate", (event) => {
        if (!allow(event.url)) event.preventDefault();
      });
      view.webContents.on("will-attach-webview", (event) => event.preventDefault());
      // Reloads and renderer failures must not leave native content over a new app screen.
      window.webContents.on("did-start-navigation", () => view.setVisible(false));
      window.webContents.on("render-process-gone", () => view.setVisible(false));
      window.on("resize", () => this.fit(window, preview!));
      window.once("closed", () => {
        this.previews.delete(window.id);
        if (!view.webContents.isDestroyed()) view.webContents.close({ waitForBeforeUnload: false });
      });
    }
    const zoom = window.webContents.getZoomFactor();
    preview.bounds = {
      x: Math.round(request.bounds.x * zoom),
      y: Math.round(request.bounds.y * zoom),
      width: Math.round(request.bounds.width * zoom),
      height: Math.round(request.bounds.height * zoom),
    };
    this.fit(window, preview);
    preview.view.setVisible(true);
    if (preview.url !== url || request.reload) {
      preview.url = url;
      preview.generation++;
      preview.loading = preview.view.webContents.loadURL(url);
    }
    const generation = preview.generation;
    try {
      await preview.loading;
    } catch {
      if (preview.generation === generation && !preview.view.webContents.isDestroyed())
        preview.view.setVisible(false);
      throw new Error("Could not load the app. Check that its development server is running.");
    }
    return true;
  }

  private fit(window: BrowserWindow, preview: Preview) {
    const [width, height] = window.getContentSize();
    const x = Math.min(preview.bounds.x, width),
      y = Math.min(preview.bounds.y, height);
    preview.view.setBounds({
      x,
      y,
      width: Math.max(0, Math.min(preview.bounds.width, width - x)),
      height: Math.max(0, Math.min(preview.bounds.height, height - y)),
    });
  }
}
