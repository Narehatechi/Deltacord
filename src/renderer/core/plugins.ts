import { dispatcherReady, FluxHandler } from "./discord";
import { logger } from "./logger";
import { pluginData, setPluginValue, SettingValue } from "./settings";
import { removeStyle, setStyle } from "./styles";

const log = logger("Plugins");

export type SettingDef =
    | { type: "boolean"; label: string; description?: string; default: boolean; }
    | { type: "select"; label: string; description?: string; default: string; options: { label: string; value: string; }[]; }
    | { type: "slider"; label: string; description?: string; default: number; min: number; max: number; step: number; unit?: string; }
    | { type: "text"; label: string; description?: string; default: string; placeholder?: string; };

type Defaults<S extends Record<string, SettingDef>> = { [K in keyof S]: S[K]["default"] };

export interface PluginDef<S extends Record<string, SettingDef> = Record<string, SettingDef>> {
    id: string;
    name: string;
    description: string;
    /** On the first time Deltacord runs. */
    enabledByDefault?: boolean;
    settings?: S;
    /** Applied while the plugin is on. A function is called again whenever a setting changes. */
    css?: string | ((settings: Defaults<S>) => string);
    /** Discord events to listen to while the plugin is on. */
    flux?: Record<string, FluxHandler>;
    /** Extra buttons on the plugin's card. */
    actions?: { label: string; run(): void; }[];
    start?(): void;
    stop?(): void;
    onSettingChange?(key: keyof S & string): void;
}

export interface Plugin<S extends Record<string, SettingDef> = Record<string, SettingDef>> extends PluginDef<S> {
    /** The plugin's settings, falling back to defaults. Assigning saves. */
    store: Defaults<S>;
    running: boolean;
}

export const plugins: Plugin[] = [];

export function definePlugin<S extends Record<string, SettingDef>>(def: PluginDef<S>): Plugin<S> {
    const saved = pluginData(def.id);
    const store = new Proxy({} as Defaults<S>, {
        get: (_t, key: string) => key in saved ? saved[key] : def.settings?.[key]?.default,
        set(_t, key: string, value: SettingValue) {
            setPluginValue(def.id, key, value);
            refresh(plugin as unknown as Plugin);
            if (plugin.running) {
                try {
                    plugin.onSettingChange?.(key);
                } catch (err) {
                    log.error(`${def.name} couldn't apply a setting`, err);
                }
            }
            return true;
        }
    });
    const plugin: Plugin<S> = { ...def, store, running: false };
    plugins.push(plugin as unknown as Plugin);
    return plugin;
}

export const isEnabled = (p: Plugin) => {
    const saved = pluginData(p.id).enabled;
    return typeof saved === "boolean" ? saved : !!p.enabledByDefault;
};

function refresh(p: Plugin) {
    if (!p.running || !p.css) return;
    setStyle(`plugin-${p.id}`, typeof p.css === "function" ? p.css(p.store) : p.css);
}

export function startPlugin(p: Plugin) {
    if (p.running) return;
    p.running = true;
    try {
        refresh(p);
        p.start?.();
    } catch (err) {
        log.error(`${p.name} failed to start`, err);
    }
    if (p.flux) {
        const handlers = p.flux;
        void dispatcherReady.then(d => {
            if (!p.running) return;
            for (const [type, handler] of Object.entries(handlers)) d.subscribe(type, safe(p, handler));
        });
    }
}

export function stopPlugin(p: Plugin) {
    if (!p.running) return;
    p.running = false;
    removeStyle(`plugin-${p.id}`);
    if (p.flux) {
        void dispatcherReady.then(d => {
            for (const type of Object.keys(p.flux ?? {})) {
                const handler = wrappedHandlers.get(p)?.get(type);
                if (handler) d.unsubscribe(type, handler);
            }
            wrappedHandlers.delete(p);
        });
    }
    try {
        p.stop?.();
    } catch (err) {
        log.error(`${p.name} failed to stop`, err);
    }
}

const wrappedHandlers = new Map<Plugin, Map<string, FluxHandler>>();

/** A plugin's mistakes are logged, never passed on to Discord. */
function safe(p: Plugin, handler: FluxHandler): FluxHandler {
    const wrapped: FluxHandler = event => {
        try {
            handler(event);
        } catch (err) {
            log.error(`${p.name} failed handling ${event.type}`, err);
        }
    };
    const map = wrappedHandlers.get(p) ?? new Map<string, FluxHandler>();
    const type = Object.entries(p.flux ?? {}).find(([, h]) => h === handler)?.[0];
    if (type) map.set(type, wrapped);
    wrappedHandlers.set(p, map);
    return wrapped;
}

export function setEnabled(p: Plugin, on: boolean) {
    setPluginValue(p.id, "enabled", on);
    if (on) startPlugin(p);
    else stopPlugin(p);
}

export function startEnabledPlugins() {
    for (const p of plugins) if (isEnabled(p)) startPlugin(p);
}
