import { ASSETS } from "./paths";

import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, session, shell, Tray } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AppInfo, IPC, ScreenSource, TITLE_BAR_HEIGHT } from "../shared/ipc";
import { appSettings, getData, getQuickCss, getSettings, setAppSettings, setData, setQuickCss, setSettings } from "./storage";
import { applySpellcheck, attachContextMenu } from "./contextMenu";
import { copyImage, copyImageLink, saveImage } from "./images";
import { cacheMedia, forgetMedia, getMedia, keepMedia } from "./media";
import { checkForUpdates, checkIfStale, getStatus, initUpdater, installUpdate, log } from "./updater";

const DISCORD_URL = "https://discord.com/app";
const DISCORD_HOSTS = /^(?:[a-z0-9-]+\.)?discord(?:app)?\.com$/i;

let win: BrowserWindow | undefined;
let tray: Tray | undefined;
let quitting = false;

const isDiscord = (url: string) => {
    try {
        const u = new URL(url);
        return u.protocol === "https:" && DISCORD_HOSTS.test(u.hostname);
    } catch {
        return false;
    }
};

function openExternal(url: unknown) {
    if (typeof url !== "string") return;
    try {
        const { protocol } = new URL(url);
        if (protocol === "https:" || protocol === "http:" || protocol === "mailto:") void shell.openExternal(url);
    } catch {
        // Not a URL: ignore it.
    }
}

function showWindow() {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
}

function openSettings() {
    showWindow();
    win?.webContents.send(IPC.openSettings);
}

function saveWindowState() {
    if (!win || win.isDestroyed()) return;
    const maximized = win.isMaximized();
    const { x, y, width, height } = maximized ? win.getNormalBounds() : win.getBounds();
    setAppSettings({ window: { x, y, width, height, maximized } });
}

const HEX = /^#[0-9a-f]{6}$/i;
/** Set once at startup: switching title bars needs a restart. */
const customTitleBar = !appSettings().nativeTitleBar;

function createWindow() {
    const saved = appSettings().window;
    win = new BrowserWindow({
        width: saved?.width ?? 1280,
        height: saved?.height ?? 800,
        x: saved?.x,
        y: saved?.y,
        minWidth: 940,
        minHeight: 500,
        title: "Deltacord",
        icon: join(ASSETS, process.platform === "win32" ? "icon.ico" : "icon.png"),
        backgroundColor: "#000000",
        autoHideMenuBar: true,
        ...(customTitleBar ? {
            titleBarStyle: "hidden" as const,
            titleBarOverlay: { color: "#000000", symbolColor: "#ffffff", height: TITLE_BAR_HEIGHT }
        } : {}),
        show: false,
        webPreferences: {
            preload: join(__dirname, "preload.js"),
            contextIsolation: true,
            sandbox: true,
            spellcheck: true,
            backgroundThrottling: false
        }
    });
    if (saved?.maximized) win.maximize();

    win.once("ready-to-show", () => win?.show());
    win.on("page-title-updated", e => {
        e.preventDefault();
        win?.setTitle("Deltacord");
    });
    win.on("close", e => {
        saveWindowState();
        if (!quitting && appSettings().minimizeToTray) {
            e.preventDefault();
            win?.hide();
        }
    });
    win.on("focus", checkIfStale);
    win.on("show", checkIfStale);
    win.on("closed", () => {
        win = undefined;
    });

    attachContextMenu(win);
    win.webContents.setWindowOpenHandler(({ url }) => {
        openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
        if (isDiscord(url)) return;
        e.preventDefault();
        openExternal(url);
    });

    watchLoading(win);
    void win.loadURL(DISCORD_URL);
}

/**
 * If Discord's page stops partway through loading (it can happen on the first start after an update, when
 * old cached files no longer match), reload it instead of leaving a black window. Twice at most.
 */
function watchLoading(w: BrowserWindow) {
    const wc = w.webContents;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let retries = 0;
    const stop = () => clearTimeout(timer);
    // Only a new page in the window itself counts: Discord's own frames and in-app navigation keep loading
    // things all the time.
    wc.on("did-start-navigation", details => {
        if (!details.isMainFrame || details.isSameDocument) return;
        stop();
        timer = setTimeout(() => {
            if (w.isDestroyed()) return;
            if (retries >= 2) return log("Discord's page is still loading after two reloads");
            retries++;
            log(`Discord's page stalled while loading; reloading (try ${retries})`);
            if (retries === 1) wc.reloadIgnoringCache();
            else void wc.session.clearCache().then(() => wc.reloadIgnoringCache());
        }, 25_000);
    });
    wc.on("dom-ready", () => { stop(); retries = 0; });
    // Discord asks before leaving the page during a call. When Deltacord is really quitting (to update,
    // or from the tray), that question would silently keep it open, so skip it.
    wc.on("will-prevent-unload", e => { if (quitting) e.preventDefault(); });
    wc.on("did-fail-load", (_e, code, description, url, isMainFrame) => {
        if (isMainFrame && code !== -3) log(`Discord's page failed to load: ${description} (${code}) ${url}`);
    });
    wc.on("render-process-gone", (_e, details) => log(`The page's process stopped: ${details.reason} (${details.exitCode})`));
    wc.on("unresponsive", () => log("The page stopped responding"));
}

/** Runs one startup step; a failure is logged instead of stopping Deltacord from opening. */
function step(name: string, run: () => void) {
    try {
        run();
    } catch (err) {
        log(`Startup step "${name}" failed: ${err instanceof Error ? err.stack : String(err)}`);
    }
}

function updateMenuItem(): Electron.MenuItemConstructorOptions {
    const status = getStatus();
    if (status.state === "ready") return { label: `Restart to Update to ${status.version}`, click: installUpdate };
    if (status.state === "downloading") return { label: `Downloading ${status.version} (${status.percent}%)`, enabled: false };
    return { label: "Check for Updates", click: () => void checkForUpdates(true) };
}

function buildTrayMenu() {
    tray?.setContextMenu(Menu.buildFromTemplate([
        { label: "Open Deltacord", click: showWindow },
        { label: "Deltacord Settings", click: openSettings },
        { type: "separator" },
        updateMenuItem(),
        { type: "separator" },
        { label: "Quit Deltacord", click: () => { quitting = true; app.quit(); } }
    ]));
}

function createTray() {
    tray = new Tray(join(ASSETS, process.platform === "win32" ? "icon.ico" : "icon.png"));
    tray.setToolTip("Deltacord");
    buildTrayMenu();
    tray.on("click", showWindow);
}

function createMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
        {
            label: "Deltacord",
            submenu: [
                { label: "Deltacord Settings", accelerator: "CmdOrCtrl+Alt+D", click: openSettings },
                { label: "Check for Updates", click: () => void checkForUpdates(true) },
                { type: "separator" },
                { label: "Quit Deltacord", accelerator: "CmdOrCtrl+Q", click: () => { quitting = true; app.quit(); } }
            ]
        },
        { role: "editMenu" },
        {
            label: "View",
            submenu: [
                { role: "reload" },
                { role: "forceReload" },
                { role: "toggleDevTools" },
                { type: "separator" },
                { role: "resetZoom" },
                { role: "zoomIn" },
                { role: "zoomOut" },
                { type: "separator" },
                { role: "togglefullscreen" }
            ]
        }
    ]));
}

/** Discord should see an ordinary Chrome browser, not an app with its own name in the user agent. */
function cleanUserAgent() {
    const ua = session.defaultSession.getUserAgent()
        .replace(/\s(?:Deltacord|deltacord|Electron)\/\S+/g, "");
    session.defaultSession.setUserAgent(ua);
    app.userAgentFallback = ua;
}

const ALLOWED_PERMISSIONS = new Set([
    "media", "notifications", "clipboard-sanitized-write", "clipboard-read", "fullscreen",
    "pointerLock", "speaker-selection", "display-capture", "idle-detection"
]);

function setUpPermissions() {
    const ses = session.defaultSession;
    ses.setPermissionRequestHandler((wc, permission, callback) =>
        callback(ALLOWED_PERMISSIONS.has(permission) && isDiscord(wc.getURL())));
    ses.setPermissionCheckHandler((_wc, permission, origin) =>
        ALLOWED_PERMISSIONS.has(permission) && isDiscord(origin));

    // Screen sharing: Deltacord shows its own picker inside the window, then hands the choice back.
    let nextPick = 0;
    ses.setDisplayMediaRequestHandler(async (_request, callback) => {
        const sources = await desktopCapturer.getSources({ types: ["screen", "window"], thumbnailSize: { width: 320, height: 180 } });
        if (!win || !sources.length) return callback({});
        const id = ++nextPick;
        const list: ScreenSource[] = sources.map(s => ({
            id: s.id,
            name: s.name,
            thumbnail: s.thumbnail.toDataURL(),
            isScreen: s.id.startsWith("screen:")
        }));

        const timeout = setTimeout(() => finish(null, false), 120_000);
        const onPicked = (_e: Electron.IpcMainEvent, pickId: unknown, sourceId: unknown, audio: unknown) => {
            if (pickId === id) finish(typeof sourceId === "string" ? sourceId : null, audio === true);
        };
        function finish(sourceId: string | null, audio: boolean) {
            clearTimeout(timeout);
            ipcMain.removeListener(IPC.screenPicked, onPicked);
            const source = sources.find(s => s.id === sourceId);
            if (!source) return callback({});
            callback(audio && process.platform === "win32" ? { video: source, audio: "loopback" } : { video: source });
        }
        ipcMain.on(IPC.screenPicked, onPicked);
        win.webContents.send(IPC.pickScreen, id, list, process.platform === "win32");
    });
}

function setUpIpc() {
    const rendererCode = readFileSync(join(__dirname, "renderer.js"), "utf8");
    ipcMain.on(IPC.renderer, e => { e.returnValue = rendererCode; });
    ipcMain.on(IPC.settingsGet, e => { e.returnValue = getSettings(); });
    ipcMain.handle(IPC.settingsSet, (_e, next: unknown) => {
        const before = appSettings().spellcheck;
        setSettings(next);
        if (appSettings().spellcheck !== before) step("spell check", applySpellcheck);
    });
    ipcMain.on(IPC.quickCssGet, e => { e.returnValue = getQuickCss(); });
    ipcMain.handle(IPC.quickCssSet, (_e, css: unknown) => { setQuickCss(css); });
    ipcMain.on(IPC.dataGet, (e, key: unknown) => { e.returnValue = getData(key); });
    ipcMain.handle(IPC.dataSet, (_e, key: unknown, value: unknown) => setData(key, value));
    ipcMain.on(IPC.appInfo, e => {
        const info: AppInfo = {
            version: app.getVersion(),
            electron: process.versions.electron,
            chrome: process.versions.chrome,
            platform: process.platform,
            packaged: app.isPackaged,
            customTitleBar
        };
        e.returnValue = info;
    });
    ipcMain.handle(IPC.openExternal, (_e, url: unknown) => openExternal(url));
    ipcMain.handle(IPC.relaunch, () => {
        quitting = true;
        app.relaunch();
        app.exit(0);
    });
    ipcMain.handle(IPC.checkUpdates, () => checkForUpdates(true));
    ipcMain.handle(IPC.installUpdate, () => installUpdate());
    ipcMain.on(IPC.updateState, e => { e.returnValue = getStatus(); });
    ipcMain.on(IPC.mediaCache, (_e, url: unknown, key: unknown) => void cacheMedia(url, key));
    ipcMain.handle(IPC.mediaKeep, (_e, keys: unknown) => keepMedia(keys));
    ipcMain.handle(IPC.mediaGet, (_e, key: unknown) => getMedia(key));
    ipcMain.handle(IPC.mediaForget, (_e, keys: unknown) => forgetMedia(keys));
    ipcMain.handle(IPC.imageSave, (_e, url: unknown) => saveImage(win, url));
    ipcMain.handle(IPC.imageCopy, (_e, url: unknown) => copyImage(url));
    ipcMain.handle(IPC.imageCopyLink, (_e, url: unknown) => copyImageLink(url));
    ipcMain.on(IPC.titleBarColors, (_e, color: unknown, symbolColor: unknown, height: unknown) => {
        if (!customTitleBar || !win || typeof color !== "string" || typeof symbolColor !== "string") return;
        if (!HEX.test(color) || !HEX.test(symbolColor) || process.platform === "darwin") return;
        const h = typeof height === "number" && Number.isInteger(height) && height >= 24 && height <= 64 ? height : TITLE_BAR_HEIGHT;
        win.setTitleBarOverlay({ color, symbolColor, height: h });
    });
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.setAppUserModelId("com.narehatechi.deltacord");
    app.on("second-instance", showWindow);
    app.on("before-quit", () => {
        quitting = true;
        saveWindowState();
    });
    app.on("window-all-closed", () => {
        if (process.platform !== "darwin") app.quit();
    });
    app.on("activate", showWindow);

    void app.whenReady().then(() => {
        step("user agent", cleanUserAgent);
        step("permissions", setUpPermissions);
        setUpIpc();
        step("menu", createMenu);
        createWindow();
        step("spell check", applySpellcheck);
        step("tray", createTray);
        initUpdater({
            onChange(status) {
                win?.webContents.send(IPC.updateStatus, status);
                buildTrayMenu();
            },
            beforeInstall() {
                // Really quit this time: no hiding in the tray while the installer replaces Deltacord.
                quitting = true;
                saveWindowState();
                tray?.destroy();
                tray = undefined;
            }
        });
    });
}
