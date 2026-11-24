import { displayName, snowflakeTime, store } from "../../core/discord";
import { Native } from "../../core/native";

export interface RawMessage {
    id: string;
    channel_id: string;
    guild_id?: string;
    content?: string;
    author?: { id: string; username: string; global_name?: string | null; bot?: boolean; };
    attachments?: { filename: string; url: string; }[];
    mentions?: { id: string; }[];
    mention_everyone?: boolean;
    mention_roles?: string[];
}

export interface Snapshot {
    id: string;
    channelId: string;
    guildId?: string;
    authorId: string;
    authorName: string;
    bot: boolean;
    content: string;
    attachments: { name: string; url: string; }[];
    mentionsMe: boolean;
}

export interface Entry {
    key: string;
    kind: "deleted" | "edited";
    at: number;
    ghostPing: boolean;
    channelName: string;
    guildName: string;
    message: Snapshot;
    before?: string;
}

export interface LogLimits {
    cacheSize: number;
    maxEntries: number;
    keepDays: number;
}

const KEY = "deltalogger";
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

export function fromRaw(m: RawMessage, previous?: Snapshot): Snapshot | undefined {
    if (!m?.id || !m.channel_id || (!m.author && !previous)) return;
    const guildId = m.guild_id ?? previous?.guildId ?? guildOf(m.channel_id);
    return {
        id: m.id,
        channelId: m.channel_id,
        guildId,
        authorId: m.author?.id ?? previous?.authorId ?? "",
        authorName: m.author ? m.author.global_name || m.author.username : previous?.authorName ?? "Someone",
        bot: m.author?.bot ?? previous?.bot ?? false,
        content: m.content ?? previous?.content ?? "",
        attachments: m.attachments?.map(a => ({ name: a.filename, url: a.url })) ?? previous?.attachments ?? [],
        mentionsMe: m.mentions
            ? mentionsMe(guildId, m.mentions.map(u => u.id), !!m.mention_everyone, m.mention_roles ?? [])
            : previous?.mentionsMe ?? false
    };
}

/** A message still in Discord's own store (camelCase fields), if it's there. */
export function fromDiscordStore(channelId: string, id: string): Snapshot | undefined {
    const m = store("MessageStore")?.getMessage(channelId, id) as {
        id: string; content: string; author: { id: string; username: string; globalName?: string | null; bot?: boolean; };
        attachments?: { filename: string; url: string; }[]; mentions?: string[]; mentionEveryone?: boolean; mentionRoles?: string[];
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
        attachments: (m.attachments ?? []).map(a => ({ name: a.filename, url: a.url })),
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

export function addEntry(kind: Entry["kind"], message: Snapshot, extra: { before?: string; ghostPing?: boolean; } = {}) {
    log.unshift({
        key: `${kind}-${message.id}-${Date.now()}`,
        kind,
        at: Date.now(),
        ghostPing: !!extra.ghostPing,
        channelName: channelLabel(message.channelId),
        guildName: message.guildId ? store("GuildStore")?.getGuild(message.guildId)?.name ?? "a server" : "Direct Messages",
        message,
        before: extra.before
    });
    prune();
    changed();
}

function prune() {
    const oldest = Date.now() - limits.keepDays * 86_400_000;
    log = log.filter(e => e.at >= oldest).slice(0, limits.maxEntries);
}

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
        log = Array.isArray(parsed) ? parsed as Entry[] : [];
    } catch {
        log = [];
    }
    prune();
    listeners.forEach(fn => fn());
}

export function unload() {
    if (saveTimer) save();
    cache.clear();
}

export const getLog = () => log;

export function removeEntry(key: string) {
    log = log.filter(e => e.key !== key);
    changed();
}

export function clearLog() {
    log = [];
    changed();
}

export function subscribe(fn: () => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}
