import { ASSETS } from "./paths";

import { app, BrowserWindow, desktopCapturer, ipcMain, Menu, session, shell, Tray } from "electron";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { AppInfo, IPC, ScreenSource } from "../shared/ipc";
import { appSettings, getData, getQuickCss, getSettings, setAppSettings, setData, setQuickCss, setSettings } from "./storage";
import { checkForUpdates, checkIfStale, getStatus, initUpdater, installUpdate } from "./updater";

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

    win.webContents.setWindowOpenHandler(({ url }) => {
        openExternal(url);
        return { action: "deny" };
    });
    win.webContents.on("will-navigate", (e, url) => {
        if (isDiscord(url)) return;
        e.preventDefault();
        openExternal(url);
    });

    void win.loadURL(DISCORD_URL);
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
    ipcMain.handle(IPC.settingsSet, (_e, next: unknown) => setSettings(next));
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
            packaged: app.isPackaged
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
        cleanUserAgent();
        setUpPermissions();
        setUpIpc();
        createMenu();
        createWindow();
        createTray();
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
