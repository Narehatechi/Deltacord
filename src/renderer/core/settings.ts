import { Native } from "./native";

export type SettingValue = boolean | number | string;

export interface CoreSettings {
    startupAnimation: boolean;
    startupStyle: string;
    useQuickCss: boolean;
}

interface Data extends Record<string, unknown> {
    core?: Partial<CoreSettings>;
    plugins?: Record<string, Record<string, SettingValue>>;
    app?: { minimizeToTray?: boolean; };
}

const CORE_DEFAULTS: CoreSettings = {
    startupAnimation: true,
    startupStyle: "random",
    useQuickCss: true
};

let data: Data = {};
try {
    data = Native.settings.get() as Data;
} catch {
    data = {};
}

let saveTimer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function changed() {
    listeners.forEach(fn => fn());
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void Native.settings.set(data), 400);
}

export function onSettingsChange(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}

export function core<K extends keyof CoreSettings>(key: K): CoreSettings[K] {
    return (data.core?.[key] ?? CORE_DEFAULTS[key]) as CoreSettings[K];
}

export function setCore<K extends keyof CoreSettings>(key: K, value: CoreSettings[K]) {
    data.core = { ...data.core, [key]: value };
    changed();
}

export const minimizeToTray = () => data.app?.minimizeToTray ?? true;

export function setMinimizeToTray(value: boolean) {
    data.app = { ...data.app, minimizeToTray: value };
    changed();
}

export function pluginData(id: string): Record<string, SettingValue> {
    data.plugins ??= {};
    return data.plugins[id] ??= {};
}

export function setPluginValue(id: string, key: string, value: SettingValue) {
    pluginData(id)[key] = value;
    changed();
}

/** Everything a pack shares: plugin choices and their settings. */
export const allPluginData = () => structuredClone(data.plugins ?? {});

export function replacePluginData(plugins: Record<string, Record<string, SettingValue>>) {
    data.plugins = structuredClone(plugins);
    changed();
}
