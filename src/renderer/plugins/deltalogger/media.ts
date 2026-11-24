import { store } from "../../core/discord";
import { Native } from "../../core/native";
import { Snapshot } from "./log";

export type KeepImages = "off" | "dms" | "viewed" | "everywhere";

const queue: { url: string; key: string; }[] = [];
const queued = new Set<string>();
let timer: ReturnType<typeof setInterval> | undefined;

/** Hands images to the app a couple at a time, so a busy chat never floods the connection. */
function pump() {
    for (const job of queue.splice(0, 2)) Native.media.cache(job.url, job.key);
    if (!queue.length && timer) {
        clearInterval(timer);
        timer = undefined;
    }
}

function wanted(s: Snapshot, mode: KeepImages) {
    if (mode === "off") return false;
    if (mode === "everywhere" || !s.guildId) return true;
    return mode === "viewed" && store("SelectedChannelStore")?.getChannelId() === s.channelId;
}

/** Copies a message's pictures ahead of time, so they survive if it's deleted. */
export function prefetchImages(s: Snapshot, mode: KeepImages) {
    if (!wanted(s, mode)) return;
    for (const a of s.attachments) {
        if (!a.image || !a.key || queued.has(a.key)) continue;
        queued.add(a.key);
        if (queued.size > 5000) queued.clear();
        queue.push({ url: a.url, key: a.key });
    }
    if (queue.length > 400) queue.splice(0, queue.length - 400);
    timer ??= setInterval(pump, 400);
}

export function stopPrefetching() {
    queue.length = 0;
    queued.clear();
    if (timer) clearInterval(timer);
    timer = undefined;
}

const urls = new Map<string, Promise<string>>();

/** A kept image as a data URL ("" if it wasn't kept). */
export function keptImage(key: string) {
    let p = urls.get(key);
    if (!p) {
        p = Native.media.get(key).catch(() => "");
        urls.set(key, p);
        if (urls.size > 200) urls.delete(urls.keys().next().value as string);
    }
    return p;
}
