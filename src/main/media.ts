import "./paths";

import { app, net } from "electron";
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/*
 * Deltalogger's image keeper. Discord deletes an attachment's file soon after its message is deleted,
 * so pictures are copied ahead of time into a small rolling cache, and moved somewhere permanent when
 * their message is deleted. Only Discord's own media hosts are ever fetched.
 */

const ROOT = join(app.getPath("userData"), "deltalogger-media");
const CACHE = join(ROOT, "cache");
const KEPT = join(ROOT, "kept");
const MAX_FILE = 12 * 1024 * 1024;
const CACHE_LIMIT = 400 * 1024 * 1024;
const KEPT_LIMIT = 1024 * 1024 * 1024;
const KEY = /^\d{5,25}-\d{1,2}$/;
const HOSTS = /^(?:cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net)$/i;
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif" };

mkdirSync(CACHE, { recursive: true });
mkdirSync(KEPT, { recursive: true });

const inFlight = new Set<string>();

/** key -> file name, for each folder, so lookups don't list the folder every time. */
const index = new Map<string, Map<string, string>>([[CACHE, new Map()], [KEPT, new Map()]]);
for (const [dir, map] of index) {
    for (const name of readdirSync(dir)) map.set(name.replace(/\.[^.]+$/, ""), name);
}

function fileFor(dir: string, key: string) {
    const name = index.get(dir)?.get(key);
    return name && existsSync(join(dir, name)) ? join(dir, name) : undefined;
}

const added = (dir: string, name: string) => index.get(dir)?.set(name.replace(/\.[^.]+$/, ""), name);
const removed = (dir: string, name: string) => index.get(dir)?.delete(name.replace(/\.[^.]+$/, ""));

/** Deletes the oldest files in a folder until it fits the limit. */
function trim(dir: string, limit: number) {
    try {
        const files = readdirSync(dir).map(name => {
            const path = join(dir, name);
            const s = statSync(path);
            return { name, path, size: s.size, time: s.mtimeMs };
        }).sort((a, b) => a.time - b.time);
        let total = files.reduce((n, f) => n + f.size, 0);
        for (const f of files) {
            if (total <= limit) break;
            unlinkSync(f.path);
            removed(dir, f.name);
            total -= f.size;
        }
    } catch {
        // A file in use or already gone: try again next time.
    }
}

let trimTimer: ReturnType<typeof setTimeout> | undefined;
const trimSoon = () => {
    clearTimeout(trimTimer);
    trimTimer = setTimeout(() => trim(CACHE, CACHE_LIMIT), 5000);
};

/** Copies an image from Discord into the cache. Quietly does nothing for anything that isn't a reasonable image. */
export async function cacheMedia(url: unknown, key: unknown) {
    if (typeof url !== "string" || typeof key !== "string" || !KEY.test(key)) return;
    if (inFlight.has(key) || fileFor(CACHE, key) || fileFor(KEPT, key)) return;
    let u: URL;
    try {
        u = new URL(url);
    } catch {
        return;
    }
    if (u.protocol !== "https:" || !HOSTS.test(u.hostname)) return;

    inFlight.add(key);
    try {
        const res = await net.fetch(u.toString(), { redirect: "error" });
        const type = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
        const ext = Object.keys(TYPES).find(e => TYPES[e] === type);
        const length = Number(res.headers.get("content-length") ?? 0);
        if (!res.ok || !ext || length > MAX_FILE) return;
        const body = Buffer.from(await res.arrayBuffer());
        if (body.length > MAX_FILE) return;
        writeFileSync(join(CACHE, `${key}.${ext}`), body);
        added(CACHE, `${key}.${ext}`);
        trimSoon();
    } catch {
        // Offline, expired link or not an image: nothing to keep.
    } finally {
        inFlight.delete(key);
    }
}

/** Moves cached images of a deleted message somewhere they won't be cleaned up. */
export function keepMedia(keys: unknown) {
    if (!Array.isArray(keys)) return 0;
    let kept = 0;
    for (const key of keys) {
        if (typeof key !== "string" || !KEY.test(key)) continue;
        const file = fileFor(CACHE, key);
        if (!file) continue;
        try {
            const name = file.slice(CACHE.length + 1);
            renameSync(file, join(KEPT, name));
            removed(CACHE, name);
            added(KEPT, name);
            kept++;
        } catch {
            // Couldn't move it: leave it in the cache.
        }
    }
    if (kept) trim(KEPT, KEPT_LIMIT);
    return kept;
}

/** A kept (or still cached) image as a data URL, or "" if there isn't one. */
export function getMedia(key: unknown) {
    if (typeof key !== "string" || !KEY.test(key)) return "";
    const file = fileFor(KEPT, key) ?? fileFor(CACHE, key);
    if (!file || !existsSync(file)) return "";
    const ext = file.split(".").pop() ?? "";
    return `data:${TYPES[ext] ?? "application/octet-stream"};base64,${readFileSync(file).toString("base64")}`;
}

/** Removes kept images, for entries removed from the log (or all of them). */
export function forgetMedia(keys: unknown) {
    const all = keys === "all";
    for (const dir of [KEPT, CACHE]) {
        for (const name of readdirSync(dir)) {
            const key = name.replace(/\.[^.]+$/, "");
            if (all ? dir === KEPT : Array.isArray(keys) && keys.includes(key)) {
                try {
                    unlinkSync(join(dir, name));
                    removed(dir, name);
                } catch {
                    // Already gone.
                }
            }
        }
    }
}
