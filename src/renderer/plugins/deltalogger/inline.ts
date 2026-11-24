/*
 * Deleted messages and edits, shown right in the chat.
 *
 * When a message is deleted, a copy of it is kept where it was, marked in red, until you leave the channel.
 * When one is edited, its earlier text appears under it. Deltacord only ever adds its own elements next to
 * Discord's and never changes Discord's, so Discord's rendering carries on exactly as before.
 */

import { h } from "../../ui/dom";

const messageEl = (channelId: string, id: string) => document.getElementById(`chat-messages-${channelId}-${id}`);

export const INLINE_CSS = `
.dc-deleted { position: relative; background: rgba(255, 59, 59, 0.07) !important; box-shadow: inset 3px 0 0 #ff3b3b; cursor: pointer; }
.dc-deleted [class*="markup"], .dc-deleted [class*="messageContent"] { color: #ff6b6b !important; }
.dc-deleted img, .dc-deleted video { opacity: 0.7; }
.dc-deleted-tag { display: inline-block; margin-left: 6px; padding: 0 5px; border: 1px solid #ff3b3b; color: #ff3b3b;
    font: 10px/14px "Determination Mono", monospace; text-transform: uppercase; vertical-align: middle; }
.dc-edits { list-style: none; margin: 0 0 2px; padding: 2px 16px 2px 72px; color: var(--text-muted, #a0a0a0); font-size: 13px; line-height: 1.35; }
.dc-edits-line { white-space: pre-wrap; word-break: break-word; }
.dc-edits-line::before { content: "edited from: "; color: var(--dc-accent, #b48cff); font-family: "Determination Mono", monospace; font-size: 11px; }
`;

/** Leaves a red copy of a deleted message where it was. Returns true if the message was on screen. */
export function showDeleted(channelId: string, id: string, ghostPing: boolean, onClick: () => void) {
    const el = messageEl(channelId, id);
    if (!el?.parentNode) return false;

    const copy = el.cloneNode(true) as HTMLElement;
    const content = copy.querySelector<HTMLElement>(`[id="message-content-${id}"]`) ?? copy.querySelector<HTMLElement>("[id^='message-content-']");
    // The copy must not share ids with anything Discord renders later.
    for (const node of [copy, ...copy.querySelectorAll<HTMLElement>("[id]")]) node.removeAttribute("id");
    copy.id = `dc-deleted-${id}`;
    copy.classList.add("dc-deleted");
    copy.setAttribute("aria-label", "Deleted message");
    copy.title = "Deleted. Click to open it in Deltalogger.";
    (content ?? copy).append(h("span", { class: "dc-deleted-tag" }, ghostPing ? "ghost ping" : "deleted"));
    // Links and buttons in the copy don't work anymore; a click opens the log instead.
    copy.addEventListener("click", e => {
        e.preventDefault();
        e.stopPropagation();
        onClick();
    }, true);

    document.getElementById(`dc-edits-${id}`)?.remove();
    el.parentNode.insertBefore(copy, el);
    return true;
}

/** Adds the text a message had before an edit under it. */
export function showEdit(channelId: string, id: string, before: string) {
    const el = messageEl(channelId, id);
    if (!el?.parentNode) return;
    let note = document.getElementById(`dc-edits-${id}`);
    if (!note) {
        note = h("li", { id: `dc-edits-${id}`, class: "dc-edits", "aria-label": "Earlier versions" });
        el.parentNode.insertBefore(note, el.nextSibling);
    }
    note.append(h("div", { class: "dc-edits-line" }, before || "(no text)"));
}

export function clearInline() {
    document.querySelectorAll(".dc-deleted, .dc-edits").forEach(n => n.remove());
}
