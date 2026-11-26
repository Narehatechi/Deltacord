/*
 * Deltacord's right-click menu for text, links and pictures, in the style of a Deltarune menu: a black box
 * with a white border, Determination Mono, and the SOUL pointing at the chosen entry.
 * The main process decides what the menu can do; this only draws it and reports which entry was picked.
 */

import type { ContextMenuAction, ContextMenuInfo } from "../../shared/ipc";
import icon from "../../../build/icon.png";
import { Native } from "../core/native";
import { h } from "./dom";

interface Entry {
    label: string;
    action: ContextMenuAction;
    arg?: string;
    enabled?: boolean;
    hint?: string;
    kind?: "suggestion";
}
type Section = { title?: string; entries: Entry[]; };

let menu: HTMLElement | undefined;
let closeMenu: (() => void) | undefined;
let lastPointer: { x: number; y: number; } | undefined;

const shortLink = (url: string) => {
    try {
        const u = new URL(url);
        const rest = u.pathname.length > 1 ? u.pathname : "";
        const text = u.hostname.replace(/^www\./, "") + rest;
        return text.length > 34 ? `${text.slice(0, 33)}…` : text;
    } catch {
        return "";
    }
};

function sections(info: ContextMenuInfo): Section[] {
    const out: Section[] = [];
    if (info.misspelledWord) {
        out.push({
            title: info.suggestions.length ? "* Did you mean..." : "* No suggestions.",
            entries: [
                ...info.suggestions.map((word): Entry => ({ label: word, action: "suggestion", arg: word, kind: "suggestion" })),
                { label: `Add "${info.misspelledWord}" to dictionary`, action: "addWord" }
            ]
        });
    }
    if (info.isEditable) {
        out.push({
            entries: [
                { label: "Undo", action: "undo", enabled: info.canUndo, hint: "Ctrl+Z" },
                { label: "Redo", action: "redo", enabled: info.canRedo, hint: "Ctrl+Y" }
            ]
        }, {
            entries: [
                { label: "Cut", action: "cut", enabled: info.canCut, hint: "Ctrl+X" },
                { label: "Copy", action: "copy", enabled: info.canCopy, hint: "Ctrl+C" },
                { label: "Paste", action: "paste", enabled: info.canPaste, hint: "Ctrl+V" },
                { label: "Paste as plain text", action: "pastePlain", enabled: info.canPaste, hint: "Ctrl+Shift+V" },
                { label: "Select all", action: "selectAll", enabled: info.canSelectAll, hint: "Ctrl+A" }
            ]
        });
    } else if (info.hasSelection) {
        out.push({ entries: [{ label: "Copy", action: "copy", hint: "Ctrl+C" }] });
    }
    if (info.link) {
        out.push({
            title: `* ${shortLink(info.link)}`,
            entries: [
                { label: "Open link in browser", action: "openLink" },
                { label: "Copy link", action: "copyLink" }
            ]
        });
    }
    if (info.image) {
        out.push({
            title: "* A picture.",
            entries: [
                { label: "Copy image", action: "copyImage" },
                { label: "Save image as...", action: "saveImage" },
                { label: "Copy image link", action: "copyImageLink" }
            ]
        });
    }
    return out.filter(s => s.entries.length);
}

function close() {
    closeMenu?.();
}

export function showContextMenu(info: ContextMenuInfo) {
    close();
    const all = sections(info);
    if (!all.length || !document.body) return;

    const items: { el: HTMLElement; entry: Entry; }[] = [];
    let selected = -1;
    const select = (index: number) => {
        if (selected >= 0) items[selected].el.classList.remove("dc-cm-selected");
        selected = index;
        if (selected >= 0) items[selected].el.classList.add("dc-cm-selected");
    };
    const choose = (index: number) => {
        const item = items[index];
        if (!item || item.entry.enabled === false) return;
        close();
        Native.contextMenu.run(info.id, item.entry.action, item.entry.arg);
    };

    const box = h("div", { class: "dc-cm", role: "menu" });
    all.forEach((section, i) => {
        if (i > 0) box.append(h("div", { class: "dc-cm-line" }));
        if (section.title) box.append(h("div", { class: "dc-cm-title" }, section.title));
        for (const entry of section.entries) {
            const index = items.length;
            const disabled = entry.enabled === false;
            const el = h("div", {
                class: `dc-cm-item${disabled ? " dc-cm-disabled" : ""}${entry.kind === "suggestion" ? " dc-cm-suggestion" : ""}`,
                role: "menuitem",
                "aria-disabled": String(disabled)
            },
            h("img", { class: "dc-cm-soul", src: icon, alt: "" }),
            h("span", { class: "dc-cm-label" }, entry.label),
            entry.hint ? h("span", { class: "dc-cm-hint" }, entry.hint) : null);
            // Keep the text box focused, so cut, copy and paste act on it.
            el.addEventListener("mousedown", e => e.preventDefault());
            el.addEventListener("mouseenter", () => select(disabled ? -1 : index));
            el.addEventListener("mouseleave", () => { if (selected === index) select(-1); });
            el.addEventListener("click", () => choose(index));
            box.append(el);
            items.push({ el, entry });
        }
    });

    document.body.append(box);
    menu = box;

    // Place it at the pointer, kept inside the window.
    const at = lastPointer ?? { x: info.x, y: info.y };
    const width = box.offsetWidth;
    const height = box.offsetHeight;
    const x = at.x + width + 8 > innerWidth ? Math.max(8, at.x - width) : at.x;
    const y = at.y + height + 8 > innerHeight ? Math.max(8, innerHeight - height - 8) : at.y;
    box.style.left = `${x}px`;
    box.style.top = `${y}px`;
    requestAnimationFrame(() => box.classList.add("dc-cm-open"));

    const enabled = () => items.map((it, i) => it.entry.enabled === false ? -1 : i).filter(i => i >= 0);
    const step = (by: number) => {
        const list = enabled();
        if (!list.length) return;
        const at = list.indexOf(selected);
        select(list[at < 0 ? (by > 0 ? 0 : list.length - 1) : (at + by + list.length) % list.length]);
    };
    const onKey = (e: KeyboardEvent) => {
        const key = e.key.toLowerCase();
        if (key === "arrowdown" || key === "arrowup") step(key === "arrowdown" ? 1 : -1);
        else if ((key === "enter" || key === "z") && selected >= 0) choose(selected);
        else if (key === "escape" || key === "x") close();
        else return;
        e.preventDefault();
        e.stopImmediatePropagation();
    };
    const onPointer = (e: Event) => {
        if (!box.contains(e.target as Node)) close();
    };
    const onScroll = (e: Event) => {
        if (!box.contains(e.target as Node)) close();
    };

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("mousedown", onPointer, true);
    window.addEventListener("wheel", onScroll, { capture: true, passive: true });
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    closeMenu = () => {
        closeMenu = undefined;
        menu = undefined;
        box.remove();
        window.removeEventListener("keydown", onKey, true);
        window.removeEventListener("mousedown", onPointer, true);
        window.removeEventListener("wheel", onScroll, true);
        window.removeEventListener("scroll", onScroll, true);
        window.removeEventListener("resize", close);
        window.removeEventListener("blur", close);
    };

    Native.contextMenu.shown(info.id);
}

/** Remembers where the pointer was for each right-click, in the page's own coordinates. */
export function setUpContextMenu() {
    window.addEventListener("contextmenu", e => {
        lastPointer = { x: e.clientX, y: e.clientY };
        if (menu) close();
    }, { capture: true, passive: true });
    Native.on("deltacord:context-menu", info => {
        try {
            showContextMenu(info as ContextMenuInfo);
        } catch (err) {
            // Not saying "shown" lets Windows' own menu appear instead.
            console.error("[Deltacord] Couldn't draw the right-click menu", err);
            close();
        }
    });
}
