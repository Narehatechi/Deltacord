/** Names of the messages passed between Deltacord's main process and the page. */
export const IPC = {
    settingsGet: "deltacord:settings-get",
    settingsSet: "deltacord:settings-set",
    quickCssGet: "deltacord:quickcss-get",
    quickCssSet: "deltacord:quickcss-set",
    dataGet: "deltacord:data-get",
    dataSet: "deltacord:data-set",
    renderer: "deltacord:renderer",
    appInfo: "deltacord:app-info",
    openExternal: "deltacord:open-external",
    relaunch: "deltacord:relaunch",
    checkUpdates: "deltacord:check-updates",
    installUpdate: "deltacord:install-update",
    updateState: "deltacord:update-state",
    titleBarColors: "deltacord:title-bar-colors",
    screenPicked: "deltacord:screen-picked",

    // main process -> page
    openSettings: "deltacord:open-settings",
    pickScreen: "deltacord:pick-screen",
    updateStatus: "deltacord:update-status"
} as const;

/** Events the page may listen to. */
export const PAGE_EVENTS = [IPC.openSettings, IPC.pickScreen, IPC.updateStatus] as const;
export type PageEvent = typeof PAGE_EVENTS[number];

export interface AppInfo {
    version: string;
    electron: string;
    chrome: string;
    platform: string;
    packaged: boolean;
    /** Deltacord draws its own title bar (Windows still draws the window buttons). */
    customTitleBar: boolean;
}

export interface ScreenSource {
    id: string;
    name: string;
    thumbnail: string;
    isScreen: boolean;
}

export type UpdateStatus =
    | { state: "idle"; }
    | { state: "checking"; manual: boolean; }
    | { state: "none"; manual: boolean; }
    | { state: "downloading"; version: string; percent: number; }
    | { state: "ready"; version: string; }
    | { state: "error"; message: string; manual: boolean; };

/** Settings the main process itself uses; the page keeps everything else in the same file. */
export interface AppSettings {
    minimizeToTray: boolean;
    nativeTitleBar: boolean;
    window?: { x?: number; y?: number; width: number; height: number; maximized: boolean; };
}

/** Height of Deltacord's own title bar, in pixels. */
export const TITLE_BAR_HEIGHT = 32;

export const DATA_KEY = /^[a-z0-9_-]{1,64}$/i;
