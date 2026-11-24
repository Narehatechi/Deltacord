import { h } from "./dom";

let area: HTMLElement | undefined;

/** A short message at the bottom of the window, with an optional button. */
export function toast(text: string, action?: { label: string; run(): void; }, ms = 5000) {
    if (!area?.isConnected) {
        area = h("div", { class: "dc-toasts" });
        document.body.append(area);
    }
    const el = h("div", { class: "dc-toast" },
        h("span", null, text),
        action && h("button", { class: "dc-button dc-primary", type: "button", onclick: () => { action.run(); el.remove(); } }, action.label)
    );
    area.append(el);
    setTimeout(() => el.remove(), ms);
}
