import { app, BrowserWindow, clipboard, ClipboardItem, dialog, nativeImage, net } from "electron";
import { writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

/*
 * Saving and copying pictures from Discord, for the entries Deltacord adds to Discord's own picture menu.
 * Only Discord's own picture hosts are fetched.
 */

const HOSTS = /^(?:cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net)$/i;
const MAX_BYTES = 100 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
    "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "image/avif": ".avif",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"
};
/** Query parameters an attachment link needs to keep working; size and format ones are dropped for the original. */
const SIGNED = ["ex", "is", "hm"];

function parse(url: unknown): URL | undefined {
    if (typeof url !== "string") return undefined;
    try {
        const u = new URL(url);
        return u.protocol === "https:" && HOSTS.test(u.hostname) ? u : undefined;
    } catch {
        return undefined;
    }
}

/** The full-size original of a picture, instead of the shrunk preview shown in chat. */
export function originalOf(url: URL): URL {
    if (/^\/(?:attachments|ephemeral-attachments)\//.test(url.pathname) && /discordapp\.(?:net|com)$/i.test(url.hostname)) {
        const original = new URL(`https://cdn.discordapp.com${url.pathname}`);
        for (const key of SIGNED) {
            const value = url.searchParams.get(key);
            if (value) original.searchParams.set(key, value);
        }
        return original;
    }
    if (url.hostname === "cdn.discordapp.com" && /^\/(?:emojis|stickers)\//.test(url.pathname)) {
        const original = new URL(url.toString());
        original.searchParams.delete("size");
        original.searchParams.set("size", "4096");
        return original;
    }
    return url;
}

async function download(url: URL): Promise<{ bytes: Buffer; type: string; }> {
    const res = await net.fetch(url.toString(), { redirect: "follow" });
    if (!res.ok) throw new Error(`Discord answered ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new Error("That file is too big");
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_BYTES) throw new Error("That file is too big");
    return { bytes, type: (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() };
}

/** What kind of file it really is, from its first bytes (some of Discord's links don't say). */
function sniff(bytes: Buffer): string {
    const ascii = (start: number, end: number) => bytes.subarray(start, end).toString("latin1");
    if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return ".png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return ".jpg";
    if (ascii(0, 4) === "GIF8") return ".gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return ".webp";
    if (ascii(4, 8) === "ftyp") return /^(?:avif|avis)$/.test(ascii(8, 12)) ? ".avif" : /^qt/.test(ascii(8, 12)) ? ".mov" : ".mp4";
    if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return ".webm";
    return "";
}

function fileName(url: URL, type: string, bytes: Buffer) {
    let name = decodeURIComponent(url.pathname.split("/").pop() ?? "") || "image";
    name = name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "_").slice(0, 120);
    const real = sniff(bytes) || EXTENSIONS[type] || "";
    const current = extname(name).toLowerCase();
    const same = current === real || (current === ".jpeg" && real === ".jpg");
    if (real && !same) name = (current && Object.values(EXTENSIONS).includes(current) ? name.slice(0, -current.length) : name) + real;
    return name;
}

/** Asks where to save, then saves the full-size picture there. Returns the path, or "" if cancelled. */
export async function saveImage(win: BrowserWindow | undefined, url: unknown): Promise<string> {
    const u = parse(url);
    if (!u) throw new Error("That isn't a picture from Discord");
    const original = originalOf(u);
    let file = await download(original).catch(() => undefined);
    let from = original;
    if (!file) {
        file = await download(u);
        from = u;
    }
    const defaultPath = join(app.getPath("downloads"), fileName(from, file.type, file.bytes));
    const ext = extname(defaultPath).slice(1);
    const options = { title: "Save image", defaultPath, filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }, { name: "All files", extensions: ["*"] }] : [] };
    const choice = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options);
    if (choice.canceled || !choice.filePath) return "";
    await writeFile(choice.filePath, file.bytes);
    return choice.filePath;
}

/** Puts the picture on the clipboard as a picture, so it pastes into other apps. */
export async function copyImage(url: unknown): Promise<void> {
    const u = parse(url);
    if (!u) throw new Error("That isn't a picture from Discord");
    const original = originalOf(u);
    // Windows' clipboard only takes PNG or JPEG, so ask Discord for a PNG when the picture is something else.
    const attempts = [original, u];
    if (/^\/(?:attachments|ephemeral-attachments)\//.test(u.pathname)) {
        const png = new URL(`https://media.discordapp.net${u.pathname}`);
        for (const key of SIGNED) {
            const value = u.searchParams.get(key);
            if (value) png.searchParams.set(key, value);
        }
        png.searchParams.set("format", "png");
        attempts.push(png);
    } else {
        const png = new URL(u.toString());
        png.searchParams.set("format", "png");
        attempts.push(png);
    }
    for (const attempt of attempts) {
        const file = await download(attempt).catch(() => undefined);
        if (!file) continue;
        const image = nativeImage.createFromBuffer(file.bytes);
        if (image.isEmpty()) continue;
        await clipboard.write([new ClipboardItem({ "image/png": new Blob([new Uint8Array(image.toPNG())], { type: "image/png" }) })]);
        return;
    }
    throw new Error("Couldn't read that picture");
}

export async function copyImageLink(url: unknown) {
    const u = parse(url);
    if (!u) throw new Error("That isn't a picture from Discord");
    await clipboard.writeText(originalOf(u).toString());
}
