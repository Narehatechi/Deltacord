import { logger } from "./logger";
import { filters, find, waitFor } from "./modules";

const log = logger("Discord");

export type FluxEvent = { type: string; } & Record<string, unknown>;
export type FluxHandler = (event: FluxEvent) => void;

export interface Dispatcher {
    subscribe(type: string, handler: FluxHandler): void;
    unsubscribe(type: string, handler: FluxHandler): void;
}

export interface DiscordUser {
    id: string;
    username: string;
    globalName?: string | null;
    bot?: boolean;
    getAvatarURL?(guildId?: string, size?: number): string;
}

export interface DiscordChannel {
    id: string;
    name?: string;
    guild_id?: string | null;
    recipients?: string[];
}

export interface Stores {
    UserStore: { getCurrentUser(): DiscordUser | undefined; getUser(id: string): DiscordUser | undefined; };
    ChannelStore: { getChannel(id: string): DiscordChannel | undefined; };
    GuildStore: { getGuild(id: string): { id: string; name: string; } | undefined; };
    GuildMemberStore: { getMember(guildId: string, userId: string): { roles: string[]; } | null; };
    MessageStore: { getMessage(channelId: string, messageId: string): unknown; };
    SelectedChannelStore: { getChannelId(): string | undefined; };
}

const isDispatcher = filters.byProps("dispatch", "subscribe", "unsubscribe", "isDispatching");

export let dispatcher: Dispatcher | undefined;
export const dispatcherReady = waitFor<Dispatcher>(isDispatcher).then(d => {
    dispatcher = d;
    log.info("Found Discord's event dispatcher");
    return d;
});

/** A Discord store by name, or undefined if it hasn't loaded yet. */
export function store<K extends keyof Stores>(name: K): Stores[K] | undefined {
    return find<Stores[K]>(filters.store(name));
}

/** Go somewhere inside Discord without reloading the page. */
export function navigate(path: string) {
    history.pushState(history.state, "", path);
    window.dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
}

export const jumpLink = (guildId: string | undefined | null, channelId: string, messageId?: string) =>
    `/channels/${guildId ?? "@me"}/${channelId}${messageId ? `/${messageId}` : ""}`;

/** When a Discord ID was created, in milliseconds. */
export const snowflakeTime = (id: string) => Number((BigInt(id) >> 22n) + 1420070400000n);

let connected = false;
void dispatcherReady.then(d => {
    const onOpen = () => {
        connected = true;
        d.unsubscribe("CONNECTION_OPEN", onOpen);
    };
    d.subscribe("CONNECTION_OPEN", onOpen);
});

/** Discord has drawn something worth showing: it's connected, or it's on a login or sign-up screen. */
export function discordReady() {
    if (connected) return true;
    if (/^\/(login|register|verify|reset|oauth2)/.test(location.pathname)) return !!document.querySelector("form, [class*='authBox']");
    return false;
}

export function displayName(user: DiscordUser | undefined) {
    return user ? user.globalName || user.username : "Someone";
}
