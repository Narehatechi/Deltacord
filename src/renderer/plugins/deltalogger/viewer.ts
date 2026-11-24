import { jumpLink, navigate } from "../../core/discord";
import { Native } from "../../core/native";
import { button, downloadText, h } from "../../ui/dom";
import { openModal } from "../../ui/modal";
import { toast } from "../../ui/toast";
import { clearLog, Entry, getLog, removeEntry, subscribe } from "./log";

type Tab = "all" | "deleted" | "edited" | "ghost";
const TABS: { id: Tab; label: string; }[] = [
    { id: "all", label: "All" },
    { id: "deleted", label: "Deleted" },
    { id: "edited", label: "Edited" },
    { id: "ghost", label: "Ghost pings" }
];
const PAGE = 100;

function matches(e: Entry, tab: Tab, query: string) {
    if (tab === "ghost" ? !e.ghostPing : tab !== "all" && e.kind !== tab) return false;
    if (!query) return true;
    const q = query.toLowerCase();
    return [e.message.content, e.before ?? "", e.message.authorName, e.channelName, e.guildName]
        .some(text => text.toLowerCase().includes(q));
}

export function openLog(initialQuery = "") {
    let tab: Tab = "all";
    let query = initialQuery;
    let shown = PAGE;

    const summary = h("p", { class: "dc-note" });
    const list = h("div", { class: "dl-list" });
    const tabButtons = TABS.map(t => h("button", { class: "dc-button", type: "button", onclick: () => { tab = t.id; shown = PAGE; draw(); } }, t.label));
    const search = h("input", { class: "dc-input", type: "search", placeholder: "Search text, people, channels or servers", value: query, style: "flex:1" });
    search.addEventListener("input", () => { query = search.value; shown = PAGE; draw(); });

    function card(e: Entry) {
        const m = e.message;
        const tag = e.ghostPing ? "Ghost ping" : e.kind === "edited" ? "Edited" : "Deleted";
        return h("div", { class: `dl-entry dl-${e.ghostPing ? "ghost" : e.kind}` },
            h("div", { class: "dl-head" },
                h("span", { class: "dl-tag" }, tag),
                h("span", { class: "dl-author" }, m.authorName),
                h("span", { class: "dl-meta" }, `${e.channelName} · ${e.guildName} · ${new Date(e.at).toLocaleString()}`)
            ),
            e.kind === "edited" && h("div", { class: "dl-before" }, e.before || "(no text)"),
            h("div", { class: "dl-content" }, m.content || "(no text)"),
            m.attachments.map(a => h("a", { class: "dl-file", href: "#", onclick: (ev: Event) => { ev.preventDefault(); void Native.openExternal(a.url); } }, a.name)),
            h("div", { class: "dc-buttons" },
                button("Jump", () => { navigate(jumpLink(m.guildId, m.channelId, m.id)); close(); }),
                button("Copy", () => { void navigator.clipboard.writeText(e.before ? `${e.before}\n→ ${m.content}` : m.content); toast("* Copied."); }),
                button("Remove", () => removeEntry(e.key), "danger")
            )
        );
    }

    function draw() {
        const log = getLog();
        summary.textContent = `${log.filter(e => e.kind === "deleted").length} deleted · ${log.filter(e => e.kind === "edited").length} edited · ${log.filter(e => e.ghostPing).length} ghost pings, kept on this computer.`;
        tabButtons.forEach((b, i) => b.classList.toggle("dc-primary", TABS[i].id === tab));
        const results = log.filter(e => matches(e, tab, query));
        list.replaceChildren(
            ...(results.length ? results.slice(0, shown).map(card) : [h("div", { class: "dc-empty" }, "* Nothing here yet. Deleted and edited messages show up as they happen.")]),
            ...(results.length > shown ? [button(`Show ${Math.min(PAGE, results.length - shown)} more`, () => { shown += PAGE; draw(); })] : [])
        );
    }

    const body = h("div", null,
        summary,
        h("div", { class: "dc-buttons", style: "margin:0 0 12px" }, search),
        h("div", { class: "dc-buttons", style: "margin:0 0 12px" }, tabButtons,
            button("Export", () => downloadText(`deltalogger-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(getLog(), null, 4))),
            button("Clear log", () => { if (confirm("Clear the whole Deltalogger log? This can't be undone.")) clearLog(); }, "danger")
        ),
        list
    );
    draw();
    const unsubscribe = subscribe(draw);
    const close = openModal("DELTALOGGER", body, { wide: true, onClose: unsubscribe });
}

export const VIEWER_CSS = `
.dl-list { display: flex; flex-direction: column; gap: 10px; }
.dl-entry { border: 2px solid rgb(255 255 255 / 0.35); border-left-width: 6px; padding: 10px 12px; }
.dl-deleted { border-left-color: #ff3b3b; }
.dl-edited { border-left-color: #ff8c1a; }
.dl-ghost { border-left-color: #fff; }
.dl-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.dl-tag { color: #a0a0a0; font-size: 12px; text-transform: uppercase; }
.dl-author { font-size: 16px; }
.dl-meta { color: #a0a0a0; font-size: 12px; }
.dl-before { color: #a0a0a0; text-decoration: line-through; white-space: pre-wrap; word-break: break-word; }
.dl-content { white-space: pre-wrap; word-break: break-word; }
.dl-file { display: block; color: #ff8c1a; margin-top: 4px; }
`;
