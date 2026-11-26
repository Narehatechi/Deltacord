import { app, BrowserWindow, clipboard, ContextMenuParams, ipcMain, Menu, MenuItemConstructorOptions, session, shell } from "electron";

import { ContextMenuAction, ContextMenuInfo, IPC } from "../shared/ipc";
import { appSettings } from "./storage";

/** Turns spell checking on or off, in the languages Windows is set to (falling back to English). */
export function applySpellcheck() {
    const ses = session.defaultSession;
    const on = appSettings().spellcheck;
    ses.setSpellCheckerEnabled(on);
    if (!on || process.platform === "darwin") return;
    const available = ses.availableSpellCheckerLanguages;
    const wanted = [...app.getPreferredSystemLanguages(), app.getLocale(), "en-US"]
        .map(l => available.find(a => a.toLowerCase() === l.toLowerCase()) ?? available.find(a => a.toLowerCase() === l.split("-")[0].toLowerCase()))
        .filter((l, i, all): l is string => !!l && all.indexOf(l) === i)
        .slice(0, 3);
    if (wanted.length) ses.setSpellCheckerLanguages(wanted);
}

const isWeb = (url: string) => /^https?:/i.test(url);

/** How long the page gets to say it drew Deltacord's menu before Windows' menu is shown instead. */
const PAGE_ANSWER_MS = 250;

/** Does one menu action, using what main itself saw when the menu opened (never URLs sent by the page). */
function run(win: BrowserWindow, p: ContextMenuParams, action: ContextMenuAction, arg?: unknown) {
    const wc = win.webContents;
    switch (action) {
        case "suggestion":
            if (typeof arg === "string" && p.dictionarySuggestions.includes(arg)) wc.replaceMisspelling(arg);
            return;
        case "addWord":
            if (p.misspelledWord) wc.session.addWordToSpellCheckerDictionary(p.misspelledWord);
            return;
        case "undo": return wc.undo();
        case "redo": return wc.redo();
        case "cut": return wc.cut();
        case "copy": return wc.copy();
        case "paste": return wc.paste();
        case "pastePlain": return wc.pasteAndMatchStyle();
        case "selectAll": return wc.selectAll();
        case "openLink":
            if (isWeb(p.linkURL)) void shell.openExternal(p.linkURL);
            return;
        case "copyLink":
            if (isWeb(p.linkURL)) clipboard.writeText(p.linkURL);
            return;
        case "copyImage":
            if (p.mediaType === "image") wc.copyImageAt(p.x, p.y);
            return;
        case "saveImage":
            if (p.mediaType === "image" && isWeb(p.srcURL)) wc.downloadURL(p.srcURL);
            return;
        case "copyImageLink":
            if (p.mediaType === "image" && isWeb(p.srcURL)) clipboard.writeText(p.srcURL);
            return;
    }
}

/** Windows' own menu, for when the Deltacord menu is turned off or the page can't draw it. */
function nativeMenu(win: BrowserWindow, p: ContextMenuParams) {
    const items: MenuItemConstructorOptions[] = [];
    const act = (action: ContextMenuAction, arg?: string) => () => run(win, p, action, arg);

    if (p.misspelledWord) {
        for (const word of p.dictionarySuggestions.slice(0, 6)) items.push({ label: word, click: act("suggestion", word) });
        if (!p.dictionarySuggestions.length) items.push({ label: "No suggestions", enabled: false });
        items.push({ label: `Add "${p.misspelledWord}" to dictionary`, click: act("addWord") }, { type: "separator" });
    }
    if (p.isEditable) {
        items.push(
            { label: "Undo", click: act("undo"), enabled: p.editFlags.canUndo },
            { label: "Redo", click: act("redo"), enabled: p.editFlags.canRedo },
            { type: "separator" },
            { label: "Cut", click: act("cut"), enabled: p.editFlags.canCut },
            { label: "Copy", click: act("copy"), enabled: p.editFlags.canCopy },
            { label: "Paste", click: act("paste"), enabled: p.editFlags.canPaste },
            { label: "Paste as plain text", click: act("pastePlain"), enabled: p.editFlags.canPaste },
            { label: "Select all", click: act("selectAll"), enabled: p.editFlags.canSelectAll }
        );
    } else if (p.selectionText.trim()) {
        items.push({ label: "Copy", click: act("copy") });
    }
    if (isWeb(p.linkURL)) {
        items.push({ type: "separator" }, { label: "Open link in browser", click: act("openLink") }, { label: "Copy link", click: act("copyLink") });
    }
    if (p.mediaType === "image" && isWeb(p.srcURL)) {
        items.push(
            { type: "separator" },
            { label: "Copy image", click: act("copyImage") },
            { label: "Save image as...", click: act("saveImage") },
            { label: "Copy image link", click: act("copyImageLink") }
        );
    }
    while (items.length && items[items.length - 1].type === "separator") items.pop();
    while (items.length && items[0].type === "separator") items.shift();
    if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
}

function hasAnything(p: ContextMenuParams) {
    return !!p.misspelledWord || p.isEditable || !!p.selectionText.trim() || isWeb(p.linkURL) || (p.mediaType === "image" && isWeb(p.srcURL));
}

/**
 * The right-click menu for text, links and pictures: spelling suggestions, "Add to dictionary", cut, copy
 * and paste. It only appears where Discord doesn't show a menu of its own (mainly the message box).
 * Deltacord draws it in its own style inside the page; Windows' menu is the fallback.
 */
export function attachContextMenu(win: BrowserWindow) {
    let nextId = 0;
    let open: { id: number; params: ContextMenuParams; } | undefined;
    let fallback: ReturnType<typeof setTimeout> | undefined;

    const wc = win.webContents;
    const onShown = (e: Electron.IpcMainEvent, id: unknown) => {
        if (e.sender === wc && id === open?.id) clearTimeout(fallback);
    };
    const onAction = (e: Electron.IpcMainEvent, id: unknown, action: unknown, arg: unknown) => {
        if (e.sender !== wc || win.isDestroyed() || !open || id !== open.id || typeof action !== "string") return;
        const { params } = open;
        open = undefined;
        try {
            run(win, params, action as ContextMenuAction, arg);
        } catch {
            // A menu action failing (say, a picture that's gone) is not worth a crash.
        }
    };
    ipcMain.on(IPC.contextMenuShown, onShown);
    ipcMain.on(IPC.contextMenuAction, onAction);
    win.on("closed", () => {
        clearTimeout(fallback);
        ipcMain.removeListener(IPC.contextMenuShown, onShown);
        ipcMain.removeListener(IPC.contextMenuAction, onAction);
    });

    wc.on("context-menu", (_e, p) => {
        if (!hasAnything(p)) return;
        clearTimeout(fallback);
        if (!appSettings().customContextMenu) return nativeMenu(win, p);

        const id = ++nextId;
        open = { id, params: p };
        const info: ContextMenuInfo = {
            id,
            x: p.x,
            y: p.y,
            misspelledWord: p.misspelledWord,
            suggestions: p.dictionarySuggestions.slice(0, 6),
            isEditable: p.isEditable,
            canUndo: p.editFlags.canUndo,
            canRedo: p.editFlags.canRedo,
            canCut: p.editFlags.canCut,
            canCopy: p.editFlags.canCopy,
            canPaste: p.editFlags.canPaste,
            canSelectAll: p.editFlags.canSelectAll,
            hasSelection: !!p.selectionText.trim(),
            link: isWeb(p.linkURL) ? p.linkURL : "",
            image: p.mediaType === "image" && isWeb(p.srcURL) ? p.srcURL : ""
        };
        wc.send(IPC.contextMenu, info);
        fallback = setTimeout(() => nativeMenu(win, p), PAGE_ANSWER_MS);
    });
}
