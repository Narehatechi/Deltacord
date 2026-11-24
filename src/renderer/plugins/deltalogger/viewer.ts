import { jumpLink, navigate } from "../../core/discord";
import { Native } from "../../core/native";
import { button, downloadText, h, select } from "../../ui/dom";
import { openModal } from "../../ui/modal";
import { toast } from "../../ui/toast";
import { clearLog, Entry, getLog, removeEntry, subscribe } from "./log";
import { keptImage } from "./media";

type Tab = "all" | "deleted" | "edited" | "ghost" | "images";
const TABS: { id: Tab; label: string; }[] = [
    { id: "all", label: "All" },
    { id: "deleted", label: "Deleted" },
    { id: "edited", label: "Edited" },
    { id: "ghost", label: "Ghost pings" },
    { id: "images", label: "With images" }
];
const PAGE = 60;

export interface Focus {
    query?: string;
    messageId?: string;
}

/** What one card shows: a deleted message, or a message with all of its edits. */
interface Item {
    newest: Entry;
    /** For edited messages: every version, oldest first. */
    versions?: string[];
    entries: Entry[];
}

function group(entries: Entry[]): Item[] {
    const items: Item[] = [];
    const edits = new Map<string, Item>();
    for (const e of entries) {
        if (e.kind !== "edited") {
            items.push({ newest: e, entries: [e] });
            continue;
        }
        const existing = edits.get(e.message.id);
        if (existing) {
            existing.entries.push(e);
            continue;
        }
        const item: Item = { newest: e, entries: [e] };
        edits.set(e.message.id, item);
        items.push(item);
    }
    for (const item of edits.values()) {
        // entries are newest first: each holds the text before it, and the newest holds the current text.
        const ordered = [...item.entries].reverse();
        item.versions = [...ordered.map(e => e.before ?? ""), item.newest.message.content];
    }
    return items;
}

function text(e: Entry) {
    const m = e.message;
    return [m.content, e.before ?? "", m.authorName, e.channelName, e.guildName, m.stickers.join(" "), m.embed ?? "", m.attachments.map(a => a.name).join(" ")]
        .join("\n").toLowerCase();
}

function dayLabel(at: number) {
    const d = new Date(at);
    const today = new Date();
    const yesterday = new Date(Date.now() - 86_400_000);
    if (d.toDateString() === today.toDateString()) return "Today";
    if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
    return d.toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

function showImage(src: string, name: string) {
    openModal(name, h("img", { src, alt: name, class: "dl-full" }), { wide: true });
}

function attachments(e: Entry) {
    return e.message.attachments.map(a => {
        if (!a.image || !a.key) {
            return h("a", { class: "dl-file", href: "#", onclick: (ev: Event) => { ev.preventDefault(); void Native.openExternal(a.url); } }, `📎 ${a.name}`);
        }
        const box = h("div", { class: "dl-thumb", title: a.name }, h("span", { class: "dl-thumb-wait" }, a.name));
        void keptImage(a.key).then(src => {
            if (src) {
                box.replaceChildren(h("img", { src, alt: a.name, loading: "lazy" }));
                box.addEventListener("click", () => showImage(src, a.name));
            } else {
                box.replaceChildren(h("span", { class: "dl-thumb-wait" }, `${a.name} (not saved)`));
                box.title = "Deltacord couldn't save this one before it was deleted.";
            }
        });
        return box;
    });
}

export function openLog(focus: Focus = {}) {
    let tab: Tab = "all";
    let query = focus.query ?? "";
    let person = "";
    let place = "";
    let shown = PAGE;
    let messageId = focus.messageId ?? "";

    const summary = h("div", { class: "dl-stats" });
    const list = h("div", { class: "dl-list" });
    const tabButtons = TABS.map(t => h("button", { class: "dc-button", type: "button", onclick: () => { tab = t.id; shown = PAGE; draw(); } }, t.label));
    const search = h("input", { class: "dc-input", type: "search", placeholder: "Search messages, people, channels, servers, file names", value: query, style: "flex:1;min-width:260px" });
    search.addEventListener("input", () => { query = search.value; messageId = ""; shown = PAGE; draw(); });
    const filters = h("div", { class: "dc-buttons", style: "margin:0 0 12px" });

    function drawFilters(log: Entry[]) {
        const people = new Map<string, string>();
        const places = new Map<string, string>();
        for (const e of log) {
            people.set(e.message.authorId, e.message.authorName);
            places.set(e.message.guildId ?? "dm", e.guildName);
        }
        const sorted = (m: Map<string, string>) => [...m].sort((a, b) => a[1].localeCompare(b[1])).map(([value, label]) => ({ value, label }));
        filters.replaceChildren(
            select(person, [{ value: "", label: "Everyone" }, ...sorted(people)], v => { person = v; shown = PAGE; draw(); }),
            select(place, [{ value: "", label: "Everywhere" }, ...sorted(places)], v => { place = v; shown = PAGE; draw(); }),
            messageId && button("Show everything", () => { messageId = ""; draw(); })
        );
    }

    function card(item: Item) {
        const e = item.newest;
        const m = e.message;
        const tag = e.ghostPing ? "Ghost ping" : e.kind === "edited" ? `Edited ${item.entries.length}×` : e.bulk ? "Bulk deleted" : "Deleted";
        const sent = new Date(Number((BigInt(m.id) >> 22n) + 1420070400000n));
        return h("div", { class: `dl-entry dl-${e.ghostPing ? "ghost" : e.kind}` },
            h("div", { class: "dl-head" },
                h("span", { class: "dl-tag" }, tag),
                h("span", { class: "dl-author" }, m.authorName),
                h("span", { class: "dl-meta" }, `${e.channelName} · ${e.guildName}`),
                h("span", { class: "dl-meta dl-time", title: `Sent ${sent.toLocaleString()}` }, new Date(e.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
            ),
            m.replyTo && h("div", { class: "dl-reply" }, `↪ replying to ${m.replyTo.author}: ${m.replyTo.content || "(no text)"}`),
            item.versions
                ? h("ol", { class: "dl-versions" }, item.versions.map((v, i) =>
                    h("li", { class: i === item.versions!.length - 1 ? "dl-now" : "dl-was" }, v || "(no text)")))
                : h("div", { class: "dl-content" }, m.content || (m.attachments.length || m.stickers.length ? "" : "(no text)")),
            m.stickers.length > 0 && h("div", { class: "dl-extra" }, `Sticker: ${m.stickers.join(", ")}`),
            m.embed && h("div", { class: "dl-extra" }, `Embed: ${m.embed}`),
            m.attachments.length > 0 && h("div", { class: "dl-files" }, attachments(e)),
            h("div", { class: "dc-buttons" },
                button("Jump", () => { navigate(jumpLink(m.guildId, m.channelId, m.id)); close(); }),
                button("Copy", () => {
                    void navigator.clipboard.writeText(item.versions ? item.versions.join("\n→ ") : m.content);
                    toast("* Copied.");
                }),
                button("Remove", () => item.entries.forEach(x => removeEntry(x.key)), "danger")
            )
        );
    }

    function draw() {
        const log = getLog();
        const deleted = log.filter(e => e.kind === "deleted").length;
        const edited = log.filter(e => e.kind === "edited").length;
        const ghosts = log.filter(e => e.ghostPing).length;
        const images = log.reduce((n, e) => n + (e.keptImages ?? 0), 0);
        summary.replaceChildren(...[["deleted", deleted], ["edits", edited], ["ghost pings", ghosts], ["images saved", images]]
            .map(([label, n]) => h("div", { class: "dl-stat" }, h("b", null, String(n)), h("span", null, String(label)))));
        tabButtons.forEach((b, i) => b.classList.toggle("dc-primary", TABS[i].id === tab));
        drawFilters(log);

        const q = query.toLowerCase();
        const matching = log.filter(e =>
            (!messageId || e.message.id === messageId) &&
            (tab === "all" || (tab === "ghost" ? e.ghostPing : tab === "images" ? e.message.attachments.some(a => a.image) : e.kind === tab)) &&
            (!person || e.message.authorId === person) &&
            (!place || (e.message.guildId ?? "dm") === place) &&
            (!q || text(e).includes(q)));
        const items = group(matching);

        const nodes: Node[] = [];
        let day = "";
        for (const item of items.slice(0, shown)) {
            const label = dayLabel(item.newest.at);
            if (label !== day) {
                day = label;
                nodes.push(h("div", { class: "dl-day" }, `* ${label}`));
            }
            nodes.push(card(item));
        }
        if (!items.length) nodes.push(h("div", { class: "dc-empty" }, log.length ? "* Nothing matches." : "* Nothing here yet. Deleted and edited messages show up as they happen."));
        if (items.length > shown) nodes.push(button(`Show ${Math.min(PAGE, items.length - shown)} more`, () => { shown += PAGE; draw(); }));
        list.replaceChildren(...nodes);
    }

    const body = h("div", null,
        summary,
        h("div", { class: "dc-buttons", style: "margin:12px 0" }, search),
        h("div", { class: "dc-buttons", style: "margin:0 0 8px" }, tabButtons),
        filters,
        list,
        h("div", { class: "dc-buttons dl-footer" },
            button("Export as JSON", () => downloadText(`deltalogger-${stamp()}.json`, JSON.stringify(getLog(), null, 4))),
            button("Export as text", () => downloadText(`deltalogger-${stamp()}.txt`, asText(getLog()), "text/plain")),
            button("Clear the log", () => {
                if (confirm("Clear the whole Deltalogger log and its saved images? This can't be undone.")) clearLog();
            }, "danger")
        )
    );
    draw();
    const unsubscribe = subscribe(draw);
    const close = openModal("DELTALOGGER", body, { wide: true, onClose: unsubscribe });
}

const stamp = () => new Date().toISOString().slice(0, 10);

/** A plain text version of the log, easy to read or share. */
function asText(log: Entry[]) {
    return log.map(e => {
        const m = e.message;
        const head = `[${new Date(e.at).toLocaleString()}] ${e.ghostPing ? "GHOST PING" : e.kind.toUpperCase()} · ${m.authorName} in ${e.channelName} (${e.guildName})`;
        const lines = [head];
        if (m.replyTo) lines.push(`  replying to ${m.replyTo.author}: ${m.replyTo.content}`);
        if (e.kind === "edited") lines.push(`  before: ${e.before ?? ""}`, `  after:  ${m.content}`);
        else lines.push(`  ${m.content}`);
        for (const a of m.attachments) lines.push(`  file: ${a.name} ${a.url}`);
        if (m.stickers.length) lines.push(`  sticker: ${m.stickers.join(", ")}`);
        return lines.join("\n");
    }).join("\n\n");
}

export const VIEWER_CSS = `
.dl-stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.dl-stat { border: 2px solid rgb(255 255 255 / 0.35); padding: 8px 10px; display: flex; flex-direction: column; gap: 2px; }
.dl-stat b { font-size: 22px; font-weight: normal; color: var(--dc-accent, #b48cff); }
.dl-stat span { font-size: 12px; color: #a0a0a0; }
.dl-list { display: flex; flex-direction: column; gap: 10px; }
.dl-day { margin-top: 8px; color: #a0a0a0; font-size: 14px; }
.dl-entry { border: 2px solid rgb(255 255 255 / 0.35); border-left-width: 6px; padding: 10px 12px; }
.dl-deleted { border-left-color: #ff3b3b; }
.dl-edited { border-left-color: var(--dc-accent, #b48cff); }
.dl-ghost { border-left-color: #fff; }
.dl-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 10px; margin-bottom: 6px; }
.dl-tag { color: #a0a0a0; font-size: 12px; text-transform: uppercase; }
.dl-author { font-size: 16px; }
.dl-meta { color: #a0a0a0; font-size: 12px; }
.dl-time { margin-left: auto; }
.dl-reply { color: #a0a0a0; font-size: 13px; margin-bottom: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dl-content { white-space: pre-wrap; word-break: break-word; }
.dl-versions { margin: 0; padding-left: 22px; }
.dl-versions li { white-space: pre-wrap; word-break: break-word; margin: 2px 0; padding: 0; list-style: decimal; }
.dl-was { color: #a0a0a0; text-decoration: line-through; }
.dl-now { color: #fff; }
.dl-extra { color: #c8c8c8; font-size: 13px; margin-top: 4px; }
.dl-files { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.dl-file { color: var(--dc-accent, #b48cff); }
.dl-thumb { width: 160px; height: 110px; border: 2px solid rgb(255 255 255 / 0.35); display: grid; place-items: center; overflow: hidden; cursor: zoom-in; background: #0a0a0a; }
.dl-thumb img { width: 100%; height: 100%; object-fit: cover; }
.dl-thumb-wait { padding: 6px; font-size: 11px; color: #a0a0a0; text-align: center; word-break: break-all; }
.dl-full { display: block; max-width: 100%; max-height: calc(100vh - 160px); margin: 0 auto; image-rendering: auto; }
.dl-footer { margin-top: 16px; }
`;
