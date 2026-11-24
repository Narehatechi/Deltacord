import { contextBridge, ipcRenderer, webFrame } from "electron";

import { AppInfo, IPC, PAGE_EVENTS, PageEvent, UpdateStatus } from "../shared/ipc";

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
    setTitleBarColors: (color: string, symbolColor: string, height: number) => ipcRenderer.send(IPC.titleBarColors, color, symbolColor, height),
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
