import { FluxEvent, jumpLink, navigate, store } from "../../core/discord";
import { definePlugin } from "../../core/plugins";
import { addEntry, channelLabel, forget, fromDiscordStore, fromRaw, load, RawMessage, recall, remember, sentAt, setLimits, Snapshot, unload } from "./log";
import { openLog, VIEWER_CSS } from "./viewer";

const ids = (list: string) => new Set(list.split(/[\s,]+/).filter(Boolean));

const plugin = definePlugin({
    id: "deltalogger",
    name: "Deltalogger",
    description: "Keeps deleted messages, every edit and ghost pings, even after a restart, in a searchable log. Ctrl+Alt+L opens it.",
    settings: {
        logDeletes: { type: "boolean", label: "Log deleted messages", default: true },
        logEdits: { type: "boolean", label: "Log edits", description: "Keep the old text of edited messages.", default: true },
        logBulkDeletes: { type: "boolean", label: "Log bulk deletes", description: "Messages removed many at once, for example by moderators or bots.", default: true },
        scope: {
            type: "select",
            label: "Where to log",
            default: "everywhere",
            options: [
                { label: "Everywhere", value: "everywhere" },
                { label: "Only DMs and group DMs", value: "dms" },
                { label: "Only servers", value: "servers" }
            ]
        },
        ignoreBots: { type: "boolean", label: "Ignore bots", default: true },
        ignoreSelf: { type: "boolean", label: "Ignore my own messages", default: false },
        ignoreUsers: { type: "text", label: "Ignore these people", description: "User IDs, separated by commas.", default: "", placeholder: "123456789012345678, ..." },
        ignoreChannels: { type: "text", label: "Ignore these channels", description: "Channel IDs, separated by commas.", default: "" },
        ignoreGuilds: { type: "text", label: "Ignore these servers", description: "Server IDs, separated by commas.", default: "" },
        ghostPings: { type: "boolean", label: "Ghost ping alerts", description: "Tell me when someone pings me and then deletes the message.", default: true },
        ghostPingMinutes: { type: "slider", label: "Ghost ping window", description: "Deleted within this long after sending counts as a ghost ping.", default: 10, min: 1, max: 60, step: 1, unit: " min" },
        notifyDeletes: {
            type: "select",
            label: "Notify me about deletes",
            default: "never",
            options: [{ label: "Never", value: "never" }, { label: "In DMs", value: "dms" }, { label: "Everywhere", value: "everywhere" }]
        },
        notifyEdits: { type: "boolean", label: "Notify me about edits in DMs", default: false },
        maxEntries: { type: "slider", label: "Entries to keep", default: 2500, min: 500, max: 10000, step: 500, unit: "" },
        keepDays: { type: "slider", label: "Days to keep", default: 30, min: 1, max: 365, step: 1, unit: " days" },
        cacheSize: { type: "slider", label: "Recent messages to remember", description: "So deleted ones can be recovered. Higher uses more memory.", default: 5000, min: 1000, max: 20000, step: 1000, unit: "" }
    },
    actions: [{ label: "Open the log", run: () => openLog() }],
    css: VIEWER_CSS,
    flux: {
        MESSAGE_CREATE(e: FluxEvent) {
            if (e.optimistic) return;
            const s = fromRaw(e.message as RawMessage);
            if (s) remember(s);
        },
        LOAD_MESSAGES_SUCCESS(e: FluxEvent) {
            for (const m of (e.messages as RawMessage[] | undefined) ?? []) {
                const s = fromRaw(m);
                if (s) remember(s);
            }
        },
        MESSAGE_UPDATE(e: FluxEvent) {
            onUpdate(e.message as RawMessage);
        },
        MESSAGE_DELETE(e: FluxEvent) {
            onDelete(e.id as string, e.channelId as string, false);
        },
        MESSAGE_DELETE_BULK(e: FluxEvent) {
            for (const id of (e.ids as string[] | undefined) ?? []) onDelete(id, e.channelId as string, true);
        }
    },
    start() {
        applyLimits();
        load();
        document.addEventListener("keydown", onKey, true);
    },
    stop() {
        document.removeEventListener("keydown", onKey, true);
        unload();
    },
    onSettingChange(key) {
        if (key === "cacheSize" || key === "maxEntries" || key === "keepDays") applyLimits();
    }
});

function applyLimits() {
    const { cacheSize, maxEntries, keepDays } = plugin.store;
    setLimits({ cacheSize, maxEntries, keepDays });
}

function onKey(e: KeyboardEvent) {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        openLog();
    }
}

function shouldLog(s: Snapshot) {
    const st = plugin.store;
    if (st.scope === "dms" && s.guildId) return false;
    if (st.scope === "servers" && !s.guildId) return false;
    if (st.ignoreBots && s.bot) return false;
    if (st.ignoreSelf && s.authorId === store("UserStore")?.getCurrentUser()?.id) return false;
    if (ids(st.ignoreUsers).has(s.authorId) || ids(st.ignoreChannels).has(s.channelId)) return false;
    return !(s.guildId && ids(st.ignoreGuilds).has(s.guildId));
}

function notify(title: string, s: Snapshot, body: string) {
    const avatar = store("UserStore")?.getUser(s.authorId)?.getAvatarURL?.(undefined, 64);
    const n = new Notification(title, { body: body || "(no text)", icon: avatar, silent: false });
    n.onclick = () => {
        window.focus();
        navigate(jumpLink(s.guildId, s.channelId));
    };
}

function onDelete(id: string, channelId: string, bulk: boolean) {
    if (!id || !channelId) return;
    const s = recall(id) ?? fromDiscordStore(channelId, id);
    forget(id);
    if (!s || !shouldLog(s)) return;

    const st = plugin.store;
    const ghostPing = st.ghostPings && s.mentionsMe && Date.now() - sentAt(s) <= st.ghostPingMinutes * 60_000;
    if (!ghostPing && !(bulk ? st.logBulkDeletes : st.logDeletes)) return;
    addEntry("deleted", s, { ghostPing });

    if (ghostPing) notify(`Ghost ping from ${s.authorName}`, s, `${channelLabel(s.channelId)}: ${s.content}`);
    else if (!bulk && (st.notifyDeletes === "everywhere" || (st.notifyDeletes === "dms" && !s.guildId)))
        notify(`${s.authorName} deleted a message`, s, s.content);
}

function onUpdate(m: RawMessage | undefined) {
    if (!m?.id) return;
    const old = recall(m.id);
    const now = fromRaw(m, old);
    if (!now) return;
    remember(now);
    if (!old || m.content === undefined || m.content === old.content || !plugin.store.logEdits || !shouldLog(now)) return;
    addEntry("edited", now, { before: old.content });
    if (plugin.store.notifyEdits && !now.guildId) notify(`${now.authorName} edited a message`, now, `${old.content}\n→ ${now.content}`);
}

export default plugin;
