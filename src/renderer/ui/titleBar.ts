/*
 * Deltacord's title bar. Windows still draws the minimize, maximize and close buttons (in matching colors);
 * this decides what the rest of the bar is.
 *
 * If Discord shows its own full-width bar along the top of the window, that bar becomes the title bar:
 * it can be dragged, and it leaves room for the window buttons, like in Discord's own app. Otherwise
 * Deltacord shows a slim bar of its own above Discord, with the heart and the name.
 */

import { TITLE_BAR_HEIGHT } from "../../shared/ipc";
import icon from "../../../build/icon.png";
import { Native } from "../core/native";
import { removeStyle, setStyle } from "../core/styles";
import { h } from "./dom";

const H = TITLE_BAR_HEIGHT;
/** Room for Windows' window buttons, from the window-controls-overlay CSS values (falls back to 3 × 46px). */
const BUTTONS = "calc(100vw - env(titlebar-area-x, 0px) - env(titlebar-area-width, calc(100vw - 138px)))";

const OWN_CSS = `
#dc-titlebar { position: fixed; top: 0; left: 0; right: 0; height: ${H}px; z-index: 2147483647; box-sizing: border-box;
    display: flex; align-items: center; gap: 8px; padding: 0 ${BUTTONS} 0 10px;
    background: var(--background-base-lowest, var(--background-tertiary, #000)); color: var(--text-muted, #a0a0a0);
    font: 13px/1 "Determination Mono", monospace; letter-spacing: 1px; user-select: none; -webkit-app-region: drag; }
#dc-titlebar img { width: 16px; height: 16px; image-rendering: pixelated; }
#dc-titlebar[hidden] { display: none; }
`;

const SHIFT_CSS = `
#app-mount { position: fixed !important; inset: ${H}px 0 0 0 !important; width: auto !important; height: auto !important; }
.dc-backdrop { top: ${H}px; }
`;

const NO_DRAG = ":is(button, a, input, textarea, select, [role='button'], [role='tab'], [role='link'], [role='searchbox'], [role='combobox'], [contenteditable='true'], [tabindex]:not([tabindex='-1']))";

let bar: HTMLElement | undefined;
let usingDiscordBar = "";
let lastColors = "";

/** Discord's own bar along the very top of the window, if it has one right now. */
function findDiscordBar(): HTMLElement | null | undefined {
    const mount = document.getElementById("app-mount");
    if (!mount) return undefined;
    const area = mount.getBoundingClientRect();
    if (area.width < 200) return undefined;
    const hit = document.elementFromPoint(area.left + area.width / 2, area.top + 4);
    // Something of Deltacord's (the animation, a dialog) is covering the page: can't tell yet.
    if (!hit || !mount.contains(hit)) return undefined;
    for (let el: HTMLElement | null = hit as HTMLElement; el && el !== mount; el = el.parentElement) {
        const r = el.getBoundingClientRect();
        const fullWidth = r.width >= area.width - 4;
        if (fullWidth && Math.abs(r.top - area.top) <= 1 && r.height >= 20 && r.height <= 64) return el;
        if (fullWidth && r.height > 64) break;
    }
    return null;
}

function background(el: Element) {
    for (let n: Element | null = el; n; n = n.parentElement) {
        const c = getComputedStyle(n).backgroundColor;
        const m = c.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
        if (m && (m[4] === undefined || Number(m[4]) > 0.5))
            return `#${[m[1], m[2], m[3]].map(v => Number(v).toString(16).padStart(2, "0")).join("")}`;
    }
    return "#000000";
}

function syncButtons(el: Element, height: number) {
    const color = background(el);
    const [r, g, b] = [1, 3, 5].map(i => parseInt(color.slice(i, i + 2), 16));
    const symbols = r * 0.299 + g * 0.587 + b * 0.114 > 140 ? "#000000" : "#ffffff";
    const key = `${color}${symbols}${height}`;
    if (key === lastColors) return;
    lastColors = key;
    Native.setTitleBarColors(color, symbols, height);
}

function useDiscordBar(found: HTMLElement) {
    const cls = [...found.classList].find(c => /^[\w-]+$/.test(c));
    if (!cls) return;
    if (usingDiscordBar !== cls) {
        usingDiscordBar = cls;
        setStyle("titlebar-discord", `
.${cls} { -webkit-app-region: drag; padding-right: ${BUTTONS} !important; box-sizing: border-box; }
.${cls} ${NO_DRAG} { -webkit-app-region: no-drag; }`);
        removeStyle("titlebar-shift");
        if (bar) bar.hidden = true;
    }
    syncButtons(found, Math.round(found.getBoundingClientRect().height));
}

function useOwnBar() {
    if (usingDiscordBar) {
        usingDiscordBar = "";
        removeStyle("titlebar-discord");
    }
    setStyle("titlebar-shift", SHIFT_CSS);
    if (bar) {
        bar.hidden = false;
        syncButtons(bar, H);
    }
}

function check() {
    const found = findDiscordBar();
    if (found === undefined) return;
    if (found) return useDiscordBar(found);
    // Discord's bar is only covered (by its settings, say), not gone: keep using it so nothing jumps.
    if (usingDiscordBar && document.querySelector(`.${usingDiscordBar}`)) return;
    useOwnBar();
}

export function setUpTitleBar() {
    if (!Native.appInfo.customTitleBar) return;
    setStyle("titlebar", OWN_CSS);
    setStyle("titlebar-shift", SHIFT_CSS);
    const mount = () => {
        bar = h("div", { id: "dc-titlebar" }, h("img", { src: icon, alt: "" }), h("span", null, "DELTACORD"));
        document.body.append(bar);
        syncButtons(bar, H);
        setInterval(check, 1000);
        window.addEventListener("resize", check);
    };
    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });
}
