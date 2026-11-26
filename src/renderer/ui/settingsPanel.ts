import { Native, VERSION } from "../core/native";
import { isEnabled, Plugin, plugins, setEnabled, SettingDef } from "../core/plugins";
import { allPluginData, core, customContextMenu, minimizeToTray, nativeTitleBar, replacePluginData, setCore, setMinimizeToTray, setCustomContextMenu, setNativeTitleBar, setSpellcheck, SettingValue, spellcheck } from "../core/settings";
import { applyQuickCss } from "../core/quickCss";
import { describeUpdate, onUpdateStatus, restartToUpdate, updateStatus } from "../core/updates";
import { STARTUP_STYLES } from "../splash";
import { button, colorInput, downloadText, h, pickTextFile, row, select, slider, textInput, toggle } from "./dom";
import { openModal } from "./modal";
import { toast } from "./toast";

type Tab = "general" | "plugins" | "quickcss" | "packs" | "about";
const TABS: { id: Tab; label: string; }[] = [
    { id: "general", label: "Deltacord" },
    { id: "plugins", label: "Plugins" },
    { id: "quickcss", label: "QuickCSS" },
    { id: "packs", label: "Packs" },
    { id: "about", label: "About" }
];

let closeOpen: (() => void) | undefined;

export function openSettings(tab: Tab = "general") {
    closeOpen?.();
    const content = h("div", { class: "dc-content" });
    const tabButtons = TABS.map(t => h("button", { class: "dc-tab", type: "button", onclick: () => show(t.id) }, t.label));
    function show(id: Tab) {
        tabButtons.forEach((b, i) => b.classList.toggle("dc-active", TABS[i].id === id));
        content.replaceChildren(PAGES[id]());
    }
    show(tab);
    closeOpen = openModal("DELTACORD", h("div", { class: "dc-layout" }, h("nav", { class: "dc-tabs" }, tabButtons), content), {
        wide: true,
        onClose: () => { closeOpen = undefined; }
    });
}

const PAGES: Record<Tab, () => Node> = {
    general: () => h("div", null,
        h("h2", { class: "dc-section-title" }, "Deltacord"),
        row("Startup animation", "Play the DELTACORD animation while Discord loads.",
            toggle(core("startupAnimation"), v => setCore("startupAnimation", v))),
        row("Animation style", "Which one plays. Random picks a new one each time.",
            select(core("startupStyle"), [{ label: "Random", value: "random" }, ...STARTUP_STYLES.map(([value, label]) => ({ value, label }))],
                v => setCore("startupStyle", v))),
        row("Keep running in the tray", "Closing the window hides Deltacord instead of quitting, so you still get messages.",
            toggle(minimizeToTray(), setMinimizeToTray)),
        row("Check spelling", "Underline misspelled words as you type. Right-click one for suggestions.",
            toggle(spellcheck(), setSpellcheck)),
        row("Deltacord right-click menu", "Use Deltacord's own menu for text, links and pictures. Off uses Windows' menu.",
            toggle(customContextMenu(), setCustomContextMenu)),
        row("Use the Windows title bar", "Show Windows' own title bar instead of Deltacord's. Restart Deltacord to apply.",
            toggle(nativeTitleBar(), v => { setNativeTitleBar(v); toast("* Restart Deltacord to change the title bar.", { label: "Restart", run: () => void Native.relaunch() }); })),
        updateBox(),
        h("div", { class: "dc-buttons" },
            button("Restart Deltacord", () => void Native.relaunch())
        )
    ),

    plugins: () => {
        const list = h("div");
        const draw = (query: string) => list.replaceChildren(...plugins
            .filter(p => !query || `${p.name} ${p.description}`.toLowerCase().includes(query.toLowerCase()))
            .map(pluginCard));
        const search = h("input", { class: "dc-input", type: "search", placeholder: "Search plugins", style: "width:100%;margin-bottom:12px" });
        search.addEventListener("input", () => draw(search.value));
        draw("");
        return h("div", null, h("h2", { class: "dc-section-title" }, "Plugins"), search, list);
    },

    quickcss: () => {
        const area = h("textarea", { class: "dc-textarea", spellcheck: false, placeholder: "/* Your own CSS, applied on top of Discord and Deltacord. */" });
        area.value = Native.quickCss.get();
        return h("div", null,
            h("h2", { class: "dc-section-title" }, "QuickCSS"),
            row("Use QuickCSS", "Apply the CSS below.", toggle(core("useQuickCss"), v => { setCore("useQuickCss", v); applyQuickCss(); })),
            area,
            h("div", { class: "dc-buttons" },
                button("Save and apply", async () => {
                    await Native.quickCss.set(area.value);
                    applyQuickCss();
                    toast("* Your QuickCSS is saved.");
                }, "primary")
            )
        );
    },

    packs: () => h("div", null,
        h("h2", { class: "dc-section-title" }, "Deltacord packs"),
        h("p", { class: "dc-note" }, "A pack is one .deltapack file with your plugins, their settings, your QuickCSS and your Deltavoice sound, to share or keep as a backup. Your account is never included."),
        h("div", { class: "dc-buttons" },
            button("Export pack", exportPack, "primary"),
            button("Import pack", () => void importPack())
        )
    ),

    about: () => {
        const info = Native.appInfo;
        return h("div", null,
            h("h2", { class: "dc-section-title" }, "About"),
            h("p", { class: "dc-note" }, `Deltacord ${VERSION} · Electron ${info.electron} · Chrome ${info.chrome}`),
            h("p", { class: "dc-note" }, "Made by Narehatechi. Deltacord is its own app and isn't made by or affiliated with Discord."),
            h("p", { class: "dc-note" }, "Determination Mono is by Abacadaba, based on 8-bit Operator by Grand Chaos Productions, used unchanged under CC BY-NC-ND."),
            h("div", { class: "dc-buttons" },
                button("Source code", () => void Native.openExternal("https://github.com/Narehatechi/deltacord")),
                button("Deltacord server", () => void Native.openExternal("https://discord.gg/6zm6yY5RrE"))
            )
        );
    }
};

/** Where updates stand, kept current while the settings are open. */
function updateBox() {
    const line = h("div", { class: "dc-row-label" });
    const action = h("div");
    const box = h("div", { class: "dc-row" }, h("div", { class: "dc-row-text" }, h("div", { class: "dc-row-description" }, "Updates"), line), action);
    const draw = () => {
        const s = updateStatus();
        line.textContent = describeUpdate(s);
        action.replaceChildren(s.state === "ready"
            ? button("Restart to update", restartToUpdate, "primary")
            : button("Check for updates", () => void Native.checkForUpdates()));
    };
    draw();
    const stop = onUpdateStatus(() => box.isConnected ? draw() : stop());
    return box;
}

function control(p: Plugin, key: string, def: SettingDef) {
    const value = (p.store as Record<string, SettingValue>)[key];
    const set = (v: SettingValue) => { (p.store as Record<string, SettingValue>)[key] = v; };
    switch (def.type) {
        case "boolean": return toggle(value as boolean, set);
        case "select": return select(value as string, def.options, set);
        case "slider": return slider(value as number, def.min, def.max, def.step, def.unit ?? "", set);
        case "text": return textInput(value as string, def.placeholder ?? "", set);
        case "color": return colorInput(value as string, set);
    }
}

function pluginCard(p: Plugin): HTMLElement {
    const card = h("div", { class: `dc-card${isEnabled(p) ? " dc-on" : ""}` });
    const settingsBox = h("div", { class: "dc-card-settings" });
    const drawSettings = () => settingsBox.replaceChildren(...(isEnabled(p)
        ? Object.entries(p.settings ?? {}).map(([key, def]) => row(def.label, def.description, control(p, key, def)))
        : []));
    drawSettings();
    card.append(
        h("div", { class: "dc-card-head" },
            h("div", null, h("div", { class: "dc-card-name" }, p.name), h("div", { class: "dc-card-description" }, p.description)),
            toggle(isEnabled(p), on => {
                setEnabled(p, on);
                card.classList.toggle("dc-on", on);
                drawSettings();
                actions.hidden = !on;
            })
        ),
        settingsBox
    );
    const actions = h("div", { class: "dc-card-actions", hidden: !isEnabled(p) }, (p.actions ?? []).map(a => button(a.label, a.run)));
    if (p.actions?.length) card.append(actions);
    return card;
}

interface Pack {
    format: "deltacord-pack";
    version: 2;
    createdAt: number;
    plugins: Record<string, Record<string, SettingValue>>;
    quickCss: string;
    /** Saved plugin files that belong in a pack, like a Deltavoice sound. */
    data?: Record<string, string>;
}

const PACK_DATA_KEYS = ["deltavoice-sound"];

const isPack = (v: unknown): v is Pack => {
    if (!v || typeof v !== "object") return false;
    const p = v as Partial<Pack>;
    return p.format === "deltacord-pack" && !!p.plugins && typeof p.plugins === "object" && typeof p.quickCss === "string";
};

function exportPack() {
    const data: Record<string, string> = {};
    for (const key of PACK_DATA_KEYS) {
        const value = Native.data.get(key);
        if (value) data[key] = value;
    }
    const pack: Pack = { format: "deltacord-pack", version: 2, createdAt: Date.now(), plugins: allPluginData(), quickCss: Native.quickCss.get(), data };
    downloadText("my-deltacord.deltapack", JSON.stringify(pack, null, 4));
}

async function importPack() {
    const text = await pickTextFile(".deltapack,application/json");
    if (text == null) return;
    let pack: unknown;
    try {
        pack = JSON.parse(text);
    } catch {
        pack = undefined;
    }
    if (!isPack(pack)) return toast("* That file isn't a Deltacord pack.");
    replacePluginData(pack.plugins);
    await Native.quickCss.set(pack.quickCss);
    for (const key of PACK_DATA_KEYS) {
        const value = pack.data?.[key];
        if (typeof value === "string") await Native.data.set(key, value);
    }
    toast("* Pack loaded. Restarting...");
    setTimeout(() => void Native.relaunch(), 1200);
}
