import { definePlugin } from "../core/plugins";
import { h } from "../ui/dom";

let gauge: HTMLElement | undefined;
let fill: HTMLElement | undefined;
let label: HTMLElement | undefined;

function textbox(target: EventTarget | null) {
    return target instanceof HTMLElement ? target.closest<HTMLElement>('[role="textbox"]') : null;
}

function update(e: Event) {
    const box = textbox(e.target);
    if (!box || !gauge || !fill || !label) return;
    const length = (box.innerText ?? "").replace(/\n$/, "").length;
    if (!length) {
        gauge.hidden = true;
        return;
    }
    const limit = Number(plugin.store.limit);
    const percent = Math.round(length / limit * 100);
    const rect = box.getBoundingClientRect();
    gauge.hidden = false;
    gauge.style.left = `${rect.right - 120}px`;
    gauge.style.top = `${rect.top - 26}px`;
    fill.style.width = `${Math.min(percent, 100)}%`;
    fill.style.background = percent > 100 ? "#ff3b3b" : percent >= 90 ? "#ffcc33" : "#ff8c1a";
    label.textContent = `TP ${percent}%`;
}

const plugin = definePlugin({
    id: "tensionBar",
    name: "TensionBar",
    description: "A TP gauge above the message box that fills as your message gets close to the length limit.",
    settings: {
        limit: {
            type: "select",
            label: "Length limit",
            description: "Nitro raises Discord's limit to 4000 characters.",
            default: "2000",
            options: [{ label: "2000 characters", value: "2000" }, { label: "4000 characters (Nitro)", value: "4000" }]
        }
    },
    css: `.dc-tension { position: fixed; z-index: 1000; width: 110px; height: 18px; border: 2px solid #fff; background: #000;
        font: 11px/14px "Determination Mono", monospace; color: #fff; pointer-events: none; }
    .dc-tension-fill { position: absolute; inset: 0 auto 0 0; }
    .dc-tension-label { position: relative; padding-left: 4px; mix-blend-mode: difference; }`,
    start() {
        label = h("span", { class: "dc-tension-label" });
        fill = h("div", { class: "dc-tension-fill" });
        gauge = h("div", { class: "dc-tension", hidden: true }, fill, label);
        document.body.append(gauge);
        document.addEventListener("input", update, true);
        document.addEventListener("keyup", update, true);
    },
    stop() {
        document.removeEventListener("input", update, true);
        document.removeEventListener("keyup", update, true);
        gauge?.remove();
        gauge = fill = label = undefined;
    }
});

export default plugin;
