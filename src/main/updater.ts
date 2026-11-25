import { app, Notification } from "electron";
import { autoUpdater } from "electron-updater";
import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";

import { UpdateStatus } from "../shared/ipc";

const CHECK_EVERY_MS = 30 * 60 * 1000;
const STALE_AFTER_MS = 10 * 60 * 1000;
const LOG_FILE = join(app.getPath("userData"), "updater.log");

let status: UpdateStatus = { state: "idle" };
let onChange: (status: UpdateStatus) => void = () => { };
let beforeInstall: () => void = () => { };
let lastCheck = 0;
let manualCheck = false;
let lastPercent = -1;

/** A small log in Deltacord's folder, so a failed update can be looked into later. */
export function log(line: string) {
    try {
        if (existsSync(LOG_FILE) && statSync(LOG_FILE).size > 256 * 1024) renameSync(LOG_FILE, `${LOG_FILE}.old`);
        appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
    } catch {
        // Logging must never get in the way of updating.
    }
}

function set(next: UpdateStatus) {
    status = next;
    onChange(next);
}

export const getStatus = () => status;

function notify(title: string, body: string, click?: () => void) {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: join(__dirname, "assets", "icon.png") });
    if (click) n.on("click", click);
    n.show();
}

export function initUpdater(handlers: { onChange(status: UpdateStatus): void; beforeInstall(): void; }) {
    onChange = handlers.onChange;
    beforeInstall = handlers.beforeInstall;
    log(`Deltacord ${app.getVersion()} started`);
    if (!app.isPackaged) return;

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.logger = { info: m => log(`info ${String(m)}`), warn: m => log(`warn ${String(m)}`), error: m => log(`error ${String(m)}`) };

    autoUpdater.on("checking-for-update", () => set({ state: "checking", manual: manualCheck }));
    autoUpdater.on("update-not-available", () => {
        set({ state: "none", manual: manualCheck });
        manualCheck = false;
    });
    autoUpdater.on("update-available", info => {
        lastPercent = -1;
        log(`found ${info.version}`);
        set({ state: "downloading", version: info.version, percent: 0 });
    });
    autoUpdater.on("download-progress", p => {
        const percent = Math.floor(p.percent);
        if (status.state !== "downloading" || percent === lastPercent) return;
        lastPercent = percent;
        set({ ...status, percent });
    });
    autoUpdater.on("update-downloaded", info => {
        log(`downloaded ${info.version}`);
        set({ state: "ready", version: info.version });
        notify(`Deltacord ${info.version} is ready`, "Click to restart and update now, or it updates the next time Deltacord quits.", installUpdate);
    });
    autoUpdater.on("error", err => {
        const message = err?.message ?? String(err);
        log(`error ${message}`);
        set({ state: "error", message, manual: manualCheck });
        manualCheck = false;
    });

    void checkForUpdates(false);
    setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS);
}

export async function checkForUpdates(userAsked: boolean) {
    if (!app.isPackaged) {
        if (userAsked) set({ state: "error", message: "Updates only work in the installed app.", manual: true });
        return;
    }
    if (status.state === "ready" || status.state === "downloading") {
        if (userAsked) set(status);
        return;
    }
    manualCheck = userAsked;
    lastCheck = Date.now();
    try {
        await autoUpdater.checkForUpdates();
    } catch (err) {
        // Reported through the "error" event.
        log(`check failed ${err instanceof Error ? err.message : String(err)}`);
    }
}

/** Called when the window comes back into view, so a long-open Deltacord still finds updates promptly. */
export function checkIfStale() {
    if (Date.now() - lastCheck > STALE_AFTER_MS) void checkForUpdates(false);
}

export function installUpdate() {
    if (status.state !== "ready") return;
    log("installing");
    beforeInstall();
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
}
