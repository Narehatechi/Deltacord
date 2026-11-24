import { displayName, snowflakeTime, store } from "../../core/discord";
import { Native } from "../../core/native";

/** A message as Discord sends it over the wire (snake_case). */
export interface RawMessage {
    id: string;
    channel_id: string;
    guild_id?: string;
    content?: string;
    author?: { id: string; username: string; global_name?: string | null; bot?: boolean; avatar?: string | null; };
    attachments?: { filename: string; url: string; proxy_url?: string; content_type?: string; }[];
    sticker_items?: { name: string; }[];
    embeds?: { title?: string; description?: string; url?: string; }[];
    mentions?: { id: string; }[];
    mention_everyone?: boolean;
    mention_roles?: string[];
    message_reference?: { message_id?: string; };
    referenced_message?: RawMessage | null;
}

export interface Attachment {
    name: string;
    url: string;
    image: boolean;
    /** Name of the kept copy, for images. */
    key?: string;
}

export interface Snapshot {
    id: string;
    channelId: string;
    guildId?: string;
    authorId: string;
    authorName: string;
    bot: boolean;
    content: string;
    attachments: Attachment[];
    stickers: string[];
    embed?: string;
    replyTo?: { author: string; content: string; };
    mentionsMe: boolean;
}

export interface Entry {
    key: string;
    kind: "deleted" | "edited";
    at: number;
    ghostPing: boolean;
    bulk?: boolean;
    channelName: string;
    guildName: string;
    message: Snapshot;
    /** For edits: the text before this edit. */
    before?: string;
    /** For deletes: how many of its images were kept. */
    keptImages?: number;
}

export interface LogLimits {
    cacheSize: number;
    maxEntries: number;
    keepDays: number;
}

const KEY = "deltalogger";
const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;
const cache = new Map<string, Snapshot>();
const listeners = new Set<() => void>();
let log: Entry[] = [];
let saveTimer: ReturnType<typeof setTimeout> | undefined;
let limits: LogLimits = { cacheSize: 5000, maxEntries: 2500, keepDays: 30 };

export const setLimits = (next: LogLimits) => { limits = next; };

function mentionsMe(guildId: string | undefined, userIds: string[], everyone: boolean, roles: string[]) {
    const me = store("UserStore")?.getCurrentUser();
    if (!me) return false;
    if (everyone || userIds.includes(me.id)) return true;
    if (!guildId || !roles.length) return false;
    const myRoles = store("GuildMemberStore")?.getMember(guildId, me.id)?.roles ?? [];
    return roles.some(r => myRoles.includes(r));
}

const guildOf = (channelId: string) => store("ChannelStore")?.getChannel(channelId)?.guild_id ?? undefined;

function attachmentsOf(messageId: string, list: { filename: string; url: string; content_type?: string; }[]): Attachment[] {
    return list.map((a, i) => {
        const image = (a.content_type ?? "").startsWith("image/") || IMAGE.test(a.filename);
        return { name: a.filename, url: a.url, image, key: image ? `${messageId}-${i}` : undefined };
    });
}

function embedOf(embeds: RawMessage["embeds"]) {
    const e = embeds?.find(x => x.title || x.description || x.url);
    return e ? [e.title, e.description, e.url].filter(Boolean).join(" · ").slice(0, 300) : undefined;
}

export function fromRaw(m: RawMessage, previous?: Snapshot): Snapshot | undefined {
    if (!m?.id || !m.channel_id || (!m.author && !previous)) return;
    const guildId = m.guild_id ?? previous?.guildId ?? guildOf(m.channel_id);
    const ref = m.referenced_message;
    const refSnap = ref?.id ? recall(ref.id) : m.message_reference?.message_id ? recall(m.message_reference.message_id) : undefined;
    return {
        id: m.id,
        channelId: m.channel_id,
        guildId,
        authorId: m.author?.id ?? previous?.authorId ?? "",
        authorName: m.author ? m.author.global_name || m.author.username : previous?.authorName ?? "Someone",
        bot: m.author?.bot ?? previous?.bot ?? false,
        content: m.content ?? previous?.content ?? "",
        attachments: m.attachments ? attachmentsOf(m.id, m.attachments) : previous?.attachments ?? [],
        stickers: m.sticker_items?.map(s => s.name) ?? previous?.stickers ?? [],
        embed: m.embeds ? embedOf(m.embeds) : previous?.embed,
        replyTo: ref?.author
            ? { author: ref.author.global_name || ref.author.username, content: (ref.content ?? "").slice(0, 200) }
            : refSnap ? { author: refSnap.authorName, content: refSnap.content.slice(0, 200) } : previous?.replyTo,
        mentionsMe: m.mentions
            ? mentionsMe(guildId, m.mentions.map(u => u.id), !!m.mention_everyone, m.mention_roles ?? [])
            : previous?.mentionsMe ?? false
    };
}

/** A message still in Discord's own store (camelCase fields), if it's there. */
export function fromDiscordStore(channelId: string, id: string): Snapshot | undefined {
    const m = store("MessageStore")?.getMessage(channelId, id) as {
        id: string; content: string; author: { id: string; username: string; globalName?: string | null; bot?: boolean; };
        attachments?: { filename: string; url: string; content_type?: string; }[]; mentions?: string[];
        mentionEveryone?: boolean; mentionRoles?: string[]; stickerItems?: { name: string; }[];
    } | undefined;
    if (!m?.author) return;
    const guildId = guildOf(channelId);
    return {
        id: m.id,
        channelId,
        guildId,
        authorId: m.author.id,
        authorName: m.author.globalName || m.author.username,
        bot: !!m.author.bot,
        content: m.content ?? "",
        attachments: attachmentsOf(m.id, m.attachments ?? []),
        stickers: m.stickerItems?.map(s => s.name) ?? [],
        mentionsMe: mentionsMe(guildId, m.mentions ?? [], !!m.mentionEveryone, m.mentionRoles ?? [])
    };
}

export function remember(s: Snapshot) {
    cache.delete(s.id);
    cache.set(s.id, s);
    while (cache.size > limits.cacheSize) cache.delete(cache.keys().next().value as string);
}

export const recall = (id: string) => cache.get(id);
export const forget = (id: string) => cache.delete(id);

export function channelLabel(channelId: string) {
    const channel = store("ChannelStore")?.getChannel(channelId);
    if (!channel) return "unknown channel";
    if (channel.name) return `#${channel.name}`;
    const other = store("UserStore")?.getUser(channel.recipients?.[0] ?? "");
    return other ? `DM with ${displayName(other)}` : "a DM";
}

export const sentAt = (s: Snapshot) => snowflakeTime(s.id);

export function addEntry(kind: Entry["kind"], message: Snapshot, extra: Partial<Pick<Entry, "before" | "ghostPing" | "bulk">> = {}) {
    const entry: Entry = {
        key: `${kind}-${message.id}-${Date.now()}`,
        kind,
        at: Date.now(),
        ghostPing: !!extra.ghostPing,
        bulk: extra.bulk || undefined,
        channelName: channelLabel(message.channelId),
        guildName: message.guildId ? store("GuildStore")?.getGuild(message.guildId)?.name ?? "a server" : "Direct Messages",
        message,
        before: extra.before
    };
    log.unshift(entry);
    prune();
    changed();
    return entry;
}

/** Records that a deleted message's images were saved. */
export function setKeptImages(entry: Entry, count: number) {
    entry.keptImages = count;
    changed();
}

function prune() {
    const oldest = Date.now() - limits.keepDays * 86_400_000;
    const before = log;
    log = log.filter(e => e.at >= oldest).slice(0, limits.maxEntries);
    if (log.length !== before.length) {
        const gone = new Set(before.filter(e => !log.includes(e)).flatMap(imageKeys));
        for (const e of log) for (const k of imageKeys(e)) gone.delete(k);
        if (gone.size) void Native.media.forget([...gone]);
    }
}

export const imageKeys = (e: Entry) => e.message.attachments.flatMap(a => a.key ? [a.key] : []);

function changed() {
    listeners.forEach(fn => fn());
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 1500);
}

export function save() {
    clearTimeout(saveTimer);
    saveTimer = undefined;
    void Native.data.set(KEY, JSON.stringify(log));
}

export function load() {
    try {
        const parsed: unknown = JSON.parse(Native.data.get(KEY) || "[]");
        log = Array.isArray(parsed) ? (parsed as Entry[]).map(upgrade) : [];
    } catch {
        log = [];
    }
    prune();
    listeners.forEach(fn => fn());
}

/** Entries saved by the first Deltalogger lack a few fields. */
function upgrade(e: Entry): Entry {
    e.message.stickers ??= [];
    e.message.attachments = (e.message.attachments ?? []).map(a => ({ ...a, image: a.image ?? IMAGE.test(a.name) }));
    return e;
}

export function unload() {
    if (saveTimer) save();
    cache.clear();
}

export const getLog = () => log;

export function removeEntry(key: string) {
    const entry = log.find(e => e.key === key);
    log = log.filter(e => e.key !== key);
    if (entry && entry.kind === "deleted") void Native.media.forget(imageKeys(entry));
    changed();
}

export function clearLog() {
    log = [];
    void Native.media.forget("all");
    changed();
}

export function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}
