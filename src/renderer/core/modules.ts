/*
 * Finding Discord's own modules (stores, the event dispatcher) from inside the page.
 *
 * Discord's app is split into chunks that are pushed onto a global array. Deltacord watches that array,
 * wraps each module's setup function so it learns about the module once it has loaded, and searches
 * those modules on request. The one rule: nothing here may ever throw into Discord's own loading.
 * Every look at a module is guarded, because reading an export that hasn't finished loading throws.
 */

import { logger } from "./logger";

const log = logger("Modules");

type ModuleRecord = { exports: unknown; };
type Factory = (this: unknown, module: ModuleRecord, exports: unknown, require: Require) => void;
type ModuleMap = Record<string, Factory>;
type Chunk = [unknown, ModuleMap?, ((require: Require) => void)?];
interface Require {
    (id: string | number): unknown;
    m?: ModuleMap;
    c?: Record<string, ModuleRecord>;
}

export type Filter = (value: unknown) => boolean;

const WRAPPED = Symbol("deltacord.wrapped");
const loaded: ModuleRecord[] = [];
const waiters = new Set<{ filter: Filter; resolve(value: unknown): void; }>();
let require: Require | undefined;

/** Values worth testing in one module: the exports, their default, and each named export that is ready. */
function* candidates(record: ModuleRecord): Generator<unknown> {
    const exports = record.exports;
    if (exports == null) return;
    yield exports;
    if (typeof exports !== "object" && typeof exports !== "function") return;
    let keys: string[];
    try {
        keys = Object.keys(exports);
    } catch {
        return;
    }
    for (const key of keys) {
        let value: unknown;
        try {
            value = (exports as Record<string, unknown>)[key];
        } catch {
            continue;
        }
        if (value != null && value !== exports) yield value;
    }
}

function test(filter: Filter, value: unknown) {
    try {
        return filter(value);
    } catch {
        return false;
    }
}

function search(record: ModuleRecord, filter: Filter) {
    for (const value of candidates(record)) if (test(filter, value)) return value;
    return undefined;
}

function onLoaded(record: ModuleRecord) {
    loaded.push(record);
    if (!waiters.size) return;
    for (const waiter of [...waiters]) {
        const found = search(record, waiter.filter);
        if (found !== undefined) {
            waiters.delete(waiter);
            try {
                waiter.resolve(found);
            } catch (err) {
                log.error("A module listener failed", err);
            }
        }
    }
}

function wrap(factory: Factory): Factory {
    if (typeof factory !== "function" || (factory as unknown as Record<symbol, boolean>)[WRAPPED]) return factory;
    const wrapped: Factory = function (this: unknown, module, exports, req) {
        if (!require && typeof req === "function") require = req;
        factory.call(this, module, exports, req);
        try {
            onLoaded(module);
        } catch (err) {
            log.error("Couldn't look at a module", err);
        }
    };
    (wrapped as unknown as Record<symbol, boolean>)[WRAPPED] = true;
    try {
        // Some tools read the setup function's source; keep it looking like the original.
        wrapped.toString = factory.toString.bind(factory);
    } catch {
        // Fine without it.
    }
    return wrapped;
}

function wrapChunk(chunk: unknown) {
    try {
        const modules = Array.isArray(chunk) ? (chunk as Chunk)[1] : undefined;
        if (!modules || typeof modules !== "object") return;
        for (const id of Object.keys(modules)) modules[id] = wrap(modules[id]);
    } catch (err) {
        log.error("Couldn't wrap a chunk", err);
    }
}

/** Ask Discord's loader for its require function by pushing a tiny chunk that only reads it. */
function probe(list: unknown[]) {
    if (require) return;
    try {
        list.push([[Symbol("deltacord")], {}, (req: Require) => { require ??= req; }]);
    } catch (err) {
        log.warn("Couldn't reach Discord's loader yet", err);
    }
}

function watchChunkList(list: unknown[] & { push: (...items: unknown[]) => number; }) {
    for (const chunk of list) wrapChunk(chunk);
    let realPush = list.push;
    Object.defineProperty(list, "push", {
        configurable: true,
        get() {
            // Hand out a push that calls the push current right now. Discord's loader keeps the one it
            // replaced and calls it after its own, so each must call its own predecessor, never the latest.
            const next = realPush;
            return function (this: unknown, ...chunks: unknown[]) {
                for (const chunk of chunks) wrapChunk(chunk);
                return next.apply(list, chunks);
            };
        },
        set(push: typeof realPush) {
            // Discord's loader replaces push once it starts; keep its version and keep wrapping.
            realPush = push;
            queueMicrotask(() => probe(list));
        }
    });
}

export function startWatching() {
    const NAME = "webpackChunkdiscord_app";
    const host = window as unknown as Record<string, unknown>;
    const existing = host[NAME];
    if (Array.isArray(existing)) {
        log.warn("Discord started loading before Deltacord; some early modules are only found through its cache");
        watchChunkList(existing as unknown[] & { push: (...items: unknown[]) => number; });
        probe(existing);
        return;
    }
    let list: unknown;
    Object.defineProperty(window, NAME, {
        configurable: true,
        get: () => list,
        set(value: unknown) {
            list = value;
            if (Array.isArray(value)) watchChunkList(value as unknown[] & { push: (...items: unknown[]) => number; });
        }
    });
}

function allRecords(): ModuleRecord[] {
    const cache = require?.c;
    if (!cache) return loaded;
    try {
        return [...loaded, ...Object.values(cache)];
    } catch {
        return loaded;
    }
}

/** The first loaded value that passes the filter, or undefined. */
export function find<T = unknown>(filter: Filter): T | undefined {
    for (const record of allRecords()) {
        const found = search(record, filter);
        if (found !== undefined) return found as T;
    }
    return undefined;
}

/** Resolves once a value passing the filter has loaded. */
export function waitFor<T = unknown>(filter: Filter): Promise<T> {
    const found = find<T>(filter);
    if (found !== undefined) return Promise.resolve(found);
    return new Promise(resolve => {
        waiters.add({ filter, resolve: value => resolve(value as T) });
    });
}

const isObject = (v: unknown): v is Record<string, unknown> => v != null && (typeof v === "object" || typeof v === "function");

export const filters = {
    byProps: (...props: string[]): Filter => v => isObject(v) && props.every(p => p in v),
    store: (name: string): Filter => v => {
        if (!isObject(v) || typeof v.getName !== "function") return false;
        const ctor = (v as { constructor?: { displayName?: string; }; }).constructor;
        return ctor?.displayName === name || (v.getName as () => unknown)() === name;
    }
};
