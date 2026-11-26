/*
 * Discord's web app has no "Save Image" or "Copy Image" when you right-click a picture (the official
 * desktop app adds them itself). Deltacord adds them to the top of Discord's own menu.
 */

import { Native } from "../core/native";
import { toast } from "./toast";

const HOSTS = /^(?:cdn\.discordapp\.com|media\.discordapp\.net|images-ext-\d+\.discordapp\.net)$/i;
const MENU_WAIT_MS = 1000;

const isDiscordMedia = (url: string | null | undefined): url is string => {
    if (!url) return false;
    try {
        const u = new URL(url, location.href);
        return u.protocol === "https:" && HOSTS.test(u.hostname);
    } catch {
        return false;
    }
};

/** The picture under the pointer, preferring the link to its full-size original when Discord has one. */
function pictureAt(x: number, y: number, target: EventTarget | null): string | undefined {
    const stack = [...(target instanceof Element ? [target] : []), ...document.elementsFromPoint(x, y)];
    for (const el of stack) {
        const media = el instanceof HTMLImageElement || el instanceof HTMLVideoElement ? el
            : el.querySelector?.(":scope > img, :scope > video") as HTMLImageElement | HTMLVideoElement | null;
        if (!media) continue;
        const wrapper = media.closest("[class*='imageWrapper'], [class*='mosaicItem'], [class*='imageContainer']");
        const original = wrapper?.querySelector<HTMLAnchorElement>("a[href]")?.href;
        if (isDiscordMedia(original)) return original;
        const src = media instanceof HTMLVideoElement ? (media.currentSrc || media.poster) : (media.currentSrc || media.src);
        if (isDiscordMedia(src)) return src;
    }
    return undefined;
}

const labelOf = (item: Element) => item.querySelector("[class*='label']") ?? item;

function makeItem(menu: Element, template: Element, id: string, label: string, run: () => Promise<unknown>) {
    const item = template.cloneNode(true) as HTMLElement;
    item.id = id;
    item.removeAttribute("aria-describedby");
    item.classList.add("dc-menu-item");
    for (const cls of [...item.classList]) if (/focused|disabled|danger|submenu/i.test(cls)) item.classList.remove(cls);
    labelOf(item).textContent = label;
    item.querySelectorAll("[class*='iconContainer'], [class*='subtext'], svg, img").forEach(n => n.remove());
    item.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        // Close Discord's menu the way pressing Escape inside it would.
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", keyCode: 27, bubbles: true }));
        void run();
    });
    return item;
}

/** Adds the entries; false if Discord hasn't filled the menu in yet. */
function addTo(menu: Element, url: string): boolean {
    if (menu.querySelector("#dc-image-save")) return true;
    const template = [...menu.querySelectorAll("[role='menuitem']")].find(i => !i.querySelector("[class*='submenu'], [class*='caret']"))
        ?? menu.querySelector("[role='menuitem']");
    const firstGroup = menu.querySelector("[role='group']");
    if (!template || !firstGroup?.parentElement) return false;

    const group = firstGroup.cloneNode(false) as HTMLElement;
    group.append(
        makeItem(menu, template, "dc-image-save", "Save Image", async () => {
            try {
                const path = await Native.images.save(url);
                if (path) toast(`* Saved ${path.split(/[\\/]/).pop()}.`);
            } catch (err) {
                toast(`* Couldn't save that picture. ${err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "") : ""}`);
            }
        }),
        makeItem(menu, template, "dc-image-copy", "Copy Image", async () => {
            try {
                await Native.images.copy(url);
                toast("* Copied the picture.");
            } catch {
                toast("* Couldn't copy that picture.");
            }
        }),
        makeItem(menu, template, "dc-image-copy-link", "Copy Image Link", async () => {
            try {
                await Native.images.copyLink(url);
                toast("* Copied the picture's link.");
            } catch {
                toast("* Couldn't copy that link.");
            }
        })
    );

    const separator = menu.querySelector("[role='separator']")?.cloneNode(true) as HTMLElement | undefined;
    firstGroup.parentElement.insertBefore(group, firstGroup);
    if (separator) firstGroup.parentElement.insertBefore(separator, firstGroup);
    return true;
}

function addSoon(menu: Element, url: string, tries = 10) {
    try {
        if (addTo(menu, url) || tries <= 0 || !menu.isConnected) return;
    } catch (err) {
        console.error("[Deltacord] Couldn't add the picture entries", err);
        return;
    }
    requestAnimationFrame(() => addSoon(menu, url, tries - 1));
}

export function setUpImageMenu() {
    let pending: { url: string; until: number; } | undefined;

    window.addEventListener("contextmenu", e => {
        try {
            const url = pictureAt(e.clientX, e.clientY, e.target);
            pending = url ? { url, until: performance.now() + MENU_WAIT_MS } : undefined;
        } catch {
            pending = undefined;
        }
    }, { capture: true, passive: true });

    const observer = new MutationObserver(records => {
        if (!pending) return;
        if (performance.now() > pending.until) {
            pending = undefined;
            return;
        }
        for (const record of records) {
            for (const node of record.addedNodes) {
                if (!(node instanceof Element)) continue;
                const menu = node.matches("[role='menu']") ? node : node.querySelector("[role='menu']");
                if (!menu) continue;
                const { url } = pending;
                pending = undefined;
                addSoon(menu, url);
                return;
            }
        }
    });
    const start = () => observer.observe(document.body, { childList: true, subtree: true });
    if (document.body) start();
    else document.addEventListener("DOMContentLoaded", start, { once: true });
}
