import { FluxEvent, jumpLink, navigate, store } from "../../core/discord";
import { Native } from "../../core/native";
import { definePlugin } from "../../core/plugins";
import { clearInline, INLINE_CSS, showDeleted, showEdit } from "./inline";
import { addEntry, channelLabel, forget, fromDiscordStore, fromRaw, imageKeys, load, RawMessage, recall, remember, sentAt, setKeptImages, setLimits, Snapshot, unload } from "./log";
import { KeepImages, prefetchImages, stopPrefetching } from "./media";
import { openLog, VIEWER_CSS } from "./viewer";

const ids = (list: string) => new Set(list.split(/[\s,]+/).filter(Boolean));

const plugin = definePlugin({
    id: "deltalogger",
    name: "Deltalogger",
    description: "The message logger: deleted messages stay in the chat in red, edits show their old text, pictures are saved, ghost pings are caught, and everything is kept in a searchable log, even after a restart. Ctrl+Alt+L opens it.",
    settings: {
        showDeletedInChat: { type: "boolean", label: "Keep deleted messages in the chat", description: "A red copy stays where the message was, until you leave the channel.", default: true },
        showEditsInChat: { type: "boolean", label: "Show earlier versions of edited messages", description: "The old text appears under the message.", default: true },
        keepImages: {
            type: "select",
            label: "Save pictures",
            description: "Discord removes a picture soon after its message is deleted, so Deltalogger copies them ahead of time.",
            default: "viewed",
            options: [
                { label: "In DMs and the channel I'm looking at", value: "viewed" },
                { label: "Only in DMs", value: "dms" },
                { label: "Everywhere (uses more data)", value: "everywhere" },
                { label: "Don't save pictures", value: "off" }
            ]
        },
        logDeletes: { type: "boolean", label: "Log deleted messages", default: true },
        logEdits: { type: "boolean", label: "Log edits", default: true },
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
        maxEntries: { type: "slider", label: "Entries to keep", default: 5000, min: 500, max: 20000, step: 500, unit: "" },
        keepDays: { type: "slider", label: "Days to keep", default: 60, min: 1, max: 365, step: 1, unit: " days" },
        cacheSize: { type: "slider", label: "Recent messages to remember", description: "So deleted ones can be recovered. Higher uses more memory.", default: 8000, min: 1000, max: 30000, step: 1000, unit: "" }
    },
    actions: [{ label: "Open the log", run: () => openLog() }],
    css: VIEWER_CSS + INLINE_CSS,
    flux: {
        MESSAGE_CREATE(e: FluxEvent) {
            if (e.optimistic) return;
            seen(e.message as RawMessage);
        },
        LOAD_MESSAGES_SUCCESS(e: FluxEvent) {
            for (const m of (e.messages as RawMessage[] | undefined) ?? []) seen(m);
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
        stopPrefetching();
        clearInline();
        unload();
    },
    onSettingChange(key) {
        if (key === "cacheSize" || key === "maxEntries" || key === "keepDays") applyLimits();
        if (key === "showDeletedInChat" || key === "showEditsInChat") clearInline();
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

function seen(m: RawMessage) {
    const s = fromRaw(m);
    if (!s) return;
    remember(s);
    if (s.attachments.some(a => a.image) && shouldLog(s)) prefetchImages(s, plugin.store.keepImages as KeepImages);
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
    const n = new Notification(title, { body: body || "(no text)", icon: avatar });
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

    const entry = addEntry("deleted", s, { ghostPing, bulk });
    const keys = imageKeys(entry);
    if (keys.length) void Native.media.keep(keys).then(n => { if (n) setKeptImages(entry, n); });

    if (st.showDeletedInChat) {
        try {
            showDeleted(channelId, id, ghostPing, () => openLog({ messageId: id }));
        } catch {
            // Showing it in the chat is a bonus; the log already has it.
        }
    }

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
    if (!old || m.content === undefined || m.content === old.content || !shouldLog(now)) return;
    if (plugin.store.logEdits) addEntry("edited", now, { before: old.content });
    if (plugin.store.showEditsInChat) {
        try {
            showEdit(now.channelId, now.id, old.content);
        } catch {
            // As above: the log has it.
        }
    }
    if (plugin.store.notifyEdits && !now.guildId) notify(`${now.authorName} edited a message`, now, `${old.content}\n→ ${now.content}`);
}

export default plugin;
