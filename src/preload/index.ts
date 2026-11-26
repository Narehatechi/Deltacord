import { contextBridge, ipcRenderer, webFrame } from "electron";

import { AppInfo, ContextMenuAction, IPC, PAGE_EVENTS, PageEvent, UpdateStatus } from "../shared/ipc";

/** What the page can ask of Deltacord's main process. Nothing else from Node or Electron reaches the page. */
const api = {
    settings: {
        get: (): Record<string, unknown> => ipcRenderer.sendSync(IPC.settingsGet),
        set: (value: Record<string, unknown>): Promise<void> => ipcRenderer.invoke(IPC.settingsSet, value)
    },
    quickCss: {
        get: (): string => ipcRenderer.sendSync(IPC.quickCssGet),
        set: (css: string): Promise<void> => ipcRenderer.invoke(IPC.quickCssSet, css)
    },
    data: {
        get: (key: string): string => ipcRenderer.sendSync(IPC.dataGet, key),
        set: (key: string, value: string): Promise<void> => ipcRenderer.invoke(IPC.dataSet, key, value)
    },
    appInfo: ipcRenderer.sendSync(IPC.appInfo) as AppInfo,
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke(IPC.openExternal, url),
    relaunch: (): Promise<void> => ipcRenderer.invoke(IPC.relaunch),
    checkForUpdates: (): Promise<void> => ipcRenderer.invoke(IPC.checkUpdates),
    installUpdate: (): Promise<void> => ipcRenderer.invoke(IPC.installUpdate),
    updateState: (): UpdateStatus => ipcRenderer.sendSync(IPC.updateState),
    media: {
        cache: (url: string, key: string) => ipcRenderer.send(IPC.mediaCache, url, key),
        keep: (keys: string[]): Promise<number> => ipcRenderer.invoke(IPC.mediaKeep, keys),
        get: (key: string): Promise<string> => ipcRenderer.invoke(IPC.mediaGet, key),
        forget: (keys: string[] | "all"): Promise<void> => ipcRenderer.invoke(IPC.mediaForget, keys)
    },
    setTitleBarColors: (color: string, symbolColor: string, height: number) => ipcRenderer.send(IPC.titleBarColors, color, symbolColor, height),
    images: {
        save: (url: string): Promise<string> => ipcRenderer.invoke(IPC.imageSave, url),
        copy: (url: string): Promise<void> => ipcRenderer.invoke(IPC.imageCopy, url),
        copyLink: (url: string): Promise<void> => ipcRenderer.invoke(IPC.imageCopyLink, url)
    },
    contextMenu: {
        shown: (id: number) => ipcRenderer.send(IPC.contextMenuShown, id),
        run: (id: number, action: ContextMenuAction, arg?: string) => ipcRenderer.send(IPC.contextMenuAction, id, action, arg)
    },
    screenPicked: (pickId: number, sourceId: string | null, audio: boolean) =>
        ipcRenderer.send(IPC.screenPicked, pickId, sourceId, audio),
    on(event: PageEvent, callback: (...args: unknown[]) => void) {
        if (!PAGE_EVENTS.includes(event)) return;
        ipcRenderer.on(event, (_e, ...args: unknown[]) => callback(...args));
    }
};

export type DeltacordNativeApi = typeof api;

contextBridge.exposeInMainWorld("DeltacordNative", api);

// Run Deltacord inside the page before Discord's own code starts.
void webFrame.executeJavaScript(ipcRenderer.sendSync(IPC.renderer));
