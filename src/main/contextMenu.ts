import { app, BrowserWindow, clipboard, Menu, MenuItemConstructorOptions, session, shell } from "electron";

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

/**
 * The right-click menu for text: spelling suggestions, "Add to dictionary", cut, copy and paste, plus links
 * and images. It only appears where Discord doesn't show a menu of its own (mainly the message box).
 */
export function attachContextMenu(win: BrowserWindow) {
    win.webContents.on("context-menu", (_e, p) => {
        const items: MenuItemConstructorOptions[] = [];

        if (p.misspelledWord) {
            for (const word of p.dictionarySuggestions.slice(0, 6)) {
                items.push({ label: word, click: () => win.webContents.replaceMisspelling(word) });
            }
            if (!p.dictionarySuggestions.length) items.push({ label: "No suggestions", enabled: false });
            items.push(
                { label: `Add "${p.misspelledWord}" to dictionary`, click: () => win.webContents.session.addWordToSpellCheckerDictionary(p.misspelledWord) },
                { type: "separator" }
            );
        }

        if (p.isEditable) {
            items.push(
                { label: "Undo", role: "undo", enabled: p.editFlags.canUndo },
                { label: "Redo", role: "redo", enabled: p.editFlags.canRedo },
                { type: "separator" },
                { label: "Cut", role: "cut", enabled: p.editFlags.canCut },
                { label: "Copy", role: "copy", enabled: p.editFlags.canCopy },
                { label: "Paste", role: "paste", enabled: p.editFlags.canPaste },
                { label: "Paste as plain text", role: "pasteAndMatchStyle", enabled: p.editFlags.canPaste },
                { label: "Select all", role: "selectAll", enabled: p.editFlags.canSelectAll }
            );
        } else if (p.selectionText.trim()) {
            items.push({ label: "Copy", role: "copy" });
        }

        if (p.linkURL && /^https?:/i.test(p.linkURL)) {
            items.push(
                { type: "separator" },
                { label: "Open link in browser", click: () => void shell.openExternal(p.linkURL) },
                { label: "Copy link", click: () => clipboard.writeText(p.linkURL) }
            );
        }

        if (p.mediaType === "image" && /^https?:/i.test(p.srcURL)) {
            items.push(
                { type: "separator" },
                { label: "Copy image", click: () => win.webContents.copyImageAt(p.x, p.y) },
                { label: "Save image as...", click: () => win.webContents.downloadURL(p.srcURL) },
                { label: "Copy image link", click: () => clipboard.writeText(p.srcURL) }
            );
        }

        while (items.length && items[items.length - 1].type === "separator") items.pop();
        if (items.length) Menu.buildFromTemplate(items).popup({ window: win });
    });
}
