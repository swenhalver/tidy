import { version } from "../../package.json";
import upstream from "../../upstream.json";
import { app, BrowserWindow, nativeTheme, net, protocol, screen, session, shell } from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ProjectStore } from "./project-store";
import { projectAssetResponse } from "./project-assets";
import { WorkspaceService } from "./workspace-service";
import {
  registerHarnessUpdateIPC,
  registerCloudIPC,
  registerUpdateIPC,
  registerWorkspaceIPC,
} from "./ipc";
import { CloudAuth } from "./cloud-auth";
import { CloudService } from "./cloud-service";
import { PrivateState } from "./private-state";
import { AppUpdates } from "./app-updates";
import { centeredBounds, findDisplay, requestedDisplay } from "./window-display";
import { HarnessUpdates } from "./harness-updates";
import { invalidateHarnessDetails } from "./harness-details";
import {
  APP_SCHEME,
  rendererURL,
  rendererAssetPath,
  trustedRendererURL,
} from "./renderer-security";

protocol.registerSchemesAsPrivileged([
  { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);
const entryURL = rendererURL(app.isPackaged, process.env.ELECTRON_RENDERER_URL);

let service: WorkspaceService | undefined;
let quitting: "quit" | undefined;
let updates: AppUpdates | undefined;
let harnessUpdates: HarnessUpdates | undefined;
let cloud: CloudService | undefined;
const appIcon = app.isPackaged
  ? process.platform === "linux"
    ? join(app.getAppPath(), "icon.png")
    : undefined
  : join(
      import.meta.dirname,
      "../../resources",
      process.platform === "darwin" ? "icon-macos.png" : "icon.png",
    );

/** Bounds on the display requested with --display or TIDY_DISPLAY, if it is connected. */
function requestedBounds(argv: readonly string[]) {
  const request = requestedDisplay(argv, process.env);
  if (!request) return null;
  const display = findDisplay(screen.getAllDisplays(), screen.getPrimaryDisplay(), request);
  if (!display) {
    console.warn(`Display "${request}" is not connected; opening on the default display.`);
    return null;
  }
  return centeredBounds(display, 1200, 800);
}

/** Open the workspace with its platform icon and restricted renderer permissions. */
async function createWindow() {
  const window = new BrowserWindow({
    title: "Tidy",
    icon: appIcon,
    width: 1200,
    height: 800,
    // Placed before the first show, so a requested display never flashes on the main one.
    ...requestedBounds(process.argv),
    minWidth: 640,
    minHeight: 480,
    ...(process.platform === "darwin"
      ? { titleBarStyle: "hidden" as const, trafficLightPosition: { x: 16, y: 13 } }
      : {}),
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#202020" : "#fafafa",
    show: false,
    webPreferences: {
      preload: join(import.meta.dirname, "../preload/index.cjs"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });

  // Native fullscreen hides the traffic lights; keep the renderer's inset in sync after reloads too.
  const syncFullscreen = () => {
    if (trustedRendererURL(window.webContents.mainFrame.url, entryURL))
      window.webContents.send("tidy:window-fullscreen", window.isFullScreen());
  };
  window.on("enter-full-screen", syncFullscreen);
  window.on("leave-full-screen", syncFullscreen);
  window.webContents.on("did-finish-load", syncFullscreen);
  window.once("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-redirect", (event) => event.preventDefault());
  window.webContents.on("will-frame-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  await window.loadURL(entryURL);
}

app.setName("Tidy");
app.setAboutPanelOptions({ applicationName: "Tidy", applicationVersion: version });
const ownsWorkspace = app.requestSingleInstanceLock();
if (!ownsWorkspace) app.quit();
app.on("second-instance", (_event, argv) => {
  if (quitting) return;
  const window = BrowserWindow.getAllWindows()[0];
  if (window?.isMinimized()) window.restore();
  // A relaunch with --display moves the running window to that display.
  const bounds = window && requestedBounds(argv);
  if (bounds) window.setBounds(bounds);
  window?.focus();
});

app
  .whenReady()
  .then(async () => {
    if (!ownsWorkspace) return;
    if (process.platform === "darwin" && appIcon) app.dock?.setIcon(appIcon);
    const store = new ProjectStore(
      join(app.getPath("userData"), "workspace"),
      "tidy://app/__tidy/assets",
    );
    await store.initialize();
    await store.recover();
    service = new WorkspaceService(store);
    registerWorkspaceIPC(service, entryURL);
    harnessUpdates = new HarnessUpdates({
      reserve: (id, options) => service!.reserveHarnessUpdate(id, options),
      installed: invalidateHarnessDetails,
    });
    registerHarnessUpdateIPC(harnessUpdates, entryURL);
    harnessUpdates.start();
    app.on("browser-window-focus", () => {
      void harnessUpdates?.check();
      cloud?.setForeground(true);
    });
    app.on("browser-window-blur", () => cloud?.setForeground(false));
    const privateState = new PrivateState(join(app.getPath("userData"), "cloud-sync"));
    const auth = new CloudAuth(
      process.env.TIDY_CLOUD_URL ?? "https://app.tidydesign.co",
      privateState,
      // This fork has no cloud sign-in, so it never opens the macOS keychain
      // ("Tidy Safe Storage"). Unavailable protection is the app's existing no-login path.
      {
        available: () => false,
        encrypt: () => {
          throw new Error("Cloud sign-in is turned off in this build.");
        },
        decrypt: () => {
          throw new Error("Cloud sign-in is turned off in this build.");
        },
      },
      (url) => shell.openExternal(url),
    );
    cloud = new CloudService(auth, service, privateState);
    registerCloudIPC(cloud, entryURL);
    // Do not put credential reads, catch-up, or network access on the first-paint path.
    void cloud.initialize();
    // This fork only notifies about upstream releases; it never downloads or installs them.
    updates = new AppUpdates({
      supported: app.isPackaged,
      version,
      fork: {
        ...upstream,
        ...(typeof __TIDY_BUILD_SOURCE__ === "undefined" ? {} : __TIDY_BUILD_SOURCE__),
      },
      fetch: net.fetch.bind(net),
    });
    registerUpdateIPC(updates, entryURL);
    updates.start();
    protocol.handle(APP_SCHEME, async (request) => {
      try {
        const url = new URL(request.url);
        if (url.host !== "app" || url.username || url.password)
          return new Response(null, { status: 404 });
        if (url.pathname.startsWith("/__tidy/assets/"))
          return projectAssetResponse(
            store,
            request,
            entryURL.startsWith("http") ? new URL(entryURL).origin : undefined,
            (projectId) => service!.assertProjectAccess(projectId),
          );
        if (request.method !== "GET" && request.method !== "HEAD")
          return new Response(null, { status: 405 });
        const path = rendererAssetPath(join(import.meta.dirname, "../renderer"), request.url);
        return await net.fetch(pathToFileURL(path).href);
      } catch {
        return new Response(null, { status: 404 });
      }
    });
    session.defaultSession.setPermissionRequestHandler(
      (contents, permission, callback, details) => {
        callback(
          permission === "local-fonts" &&
            details.isMainFrame &&
            trustedRendererURL(contents.mainFrame.url, entryURL) &&
            Boolean(BrowserWindow.fromWebContents(contents)),
        );
      },
    );
    session.defaultSession.setPermissionCheckHandler(
      (contents, permission, _origin, details) =>
        permission === "local-fonts" &&
        details.isMainFrame &&
        Boolean(contents && trustedRendererURL(contents.mainFrame.url, entryURL)) &&
        Boolean(contents && BrowserWindow.fromWebContents(contents)),
    );

    await createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        void createWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error("Failed to start Tidy desktop:", error);
    app.quit();
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", (event) => {
  if (!quitting) updates?.stop();
  if (quitting || !service) return;
  event.preventDefault();
  quitting = "quit";
  // Quit looks immediate while threads are checkpointed in the background. Hiding (rather than
  // closing) keeps window-all-closed from ending the process before the checkpoints are written.
  for (const window of BrowserWindow.getAllWindows()) window.hide();
  // Writes are atomic and recovery marks unfinished threads interrupted, so a stuck close
  // cannot keep Tidy running. Active harness installers are still allowed to finish.
  const deadline = new Promise((resolve) => setTimeout(resolve, 10_000));
  void Promise.all([
    Promise.race([Promise.allSettled([service.close(), cloud?.close()]), deadline]),
    harnessUpdates?.close().catch(() => {}),
  ]).finally(() => app.quit());
});
