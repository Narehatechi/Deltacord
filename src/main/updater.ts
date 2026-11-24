import { app } from "electron";
import { autoUpdater } from "electron-updater";

import { UpdateStatus } from "../shared/ipc";

let report: (status: UpdateStatus) => void = () => { };
let ready = false;

export function initUpdater(onStatus: (status: UpdateStatus) => void) {
    report = onStatus;
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on("checking-for-update", () => report({ state: "checking" }));
    autoUpdater.on("update-not-available", () => report({ state: "none" }));
    autoUpdater.on("update-available", info => report({ state: "downloading", version: info.version }));
    autoUpdater.on("update-downloaded", info => {
        ready = true;
        report({ state: "ready", version: info.version });
    });
    autoUpdater.on("error", err => report({ state: "error", message: err?.message ?? String(err) }));

    void checkForUpdates(false);
    setInterval(() => void checkForUpdates(false), 4 * 60 * 60 * 1000);
}

export async function checkForUpdates(userAsked: boolean) {
    if (!app.isPackaged) {
        if (userAsked) report({ state: "error", message: "Updates only work in the installed app." });
        return;
    }
    if (ready) return;
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        if (userAsked) report({ state: "error", message: err instanceof Error ? err.message : String(err) });
    }
}

export function installUpdate() {
    if (ready) autoUpdater.quitAndInstall(false, true);
}
