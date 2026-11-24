import "./paths";

import { app } from "electron";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { AppSettings, DATA_KEY } from "../shared/ipc";

export const DATA_DIR = app.getPath("userData");
const SETTINGS_FILE = join(DATA_DIR, "deltacord-settings.json");
const QUICKCSS_FILE = join(DATA_DIR, "quickcss.css");
const STORE_DIR = join(DATA_DIR, "deltacord-data");

/** Writes through a temporary file so a crash mid-write never leaves a broken file behind. */
function writeSafely(file: string, text: string) {
    mkdirSync(join(file, ".."), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, text, "utf8");
    renameSync(tmp, file);
}

function readText(file: string) {
    try {
        return existsSync(file) ? readFileSync(file, "utf8") : "";
    } catch {
        return "";
    }
}

export type SettingsData = Record<string, unknown> & { app?: Partial<AppSettings>; };

let settings: SettingsData = {};
try {
    const parsed: unknown = JSON.parse(readText(SETTINGS_FILE) || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) settings = parsed as SettingsData;
} catch {
    settings = {};
}

export const getSettings = () => settings;

export function setSettings(next: unknown) {
    if (!next || typeof next !== "object" || Array.isArray(next)) return;
    const incoming = next as SettingsData;
    // The window position belongs to the main process; a save from the page must not erase it.
    const window = incoming.app?.window ?? settings.app?.window;
    settings = { ...incoming, app: { ...incoming.app, ...(window ? { window } : {}) } };
    writeSafely(SETTINGS_FILE, JSON.stringify(settings, null, 4));
}

export function appSettings(): AppSettings {
    return { minimizeToTray: true, nativeTitleBar: false, spellcheck: true, ...settings.app };
}

export function setAppSettings(patch: Partial<AppSettings>) {
    setSettings({ ...settings, app: { ...settings.app, ...patch } });
}

export const getQuickCss = () => readText(QUICKCSS_FILE);
export const setQuickCss = (css: unknown) => typeof css === "string" && writeSafely(QUICKCSS_FILE, css);

export function getData(key: unknown) {
    return typeof key === "string" && DATA_KEY.test(key) ? readText(join(STORE_DIR, `${key}.json`)) : "";
}

export function setData(key: unknown, value: unknown) {
    if (typeof key !== "string" || !DATA_KEY.test(key) || typeof value !== "string") return;
    writeSafely(join(STORE_DIR, `${key}.json`), value);
}
