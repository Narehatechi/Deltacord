const styles = new Map<string, HTMLStyleElement>();

function whenHeadExists(run: () => void) {
    if (document.head) return run();
    const observer = new MutationObserver(() => {
        if (!document.head) return;
        observer.disconnect();
        run();
    });
    observer.observe(document.documentElement ?? document, { childList: true, subtree: true });
}

/** Adds or replaces a stylesheet by id. Deltacord's sheets go last so they win over Discord's. */
export function setStyle(id: string, css: string) {
    let el = styles.get(id);
    if (!el) {
        el = document.createElement("style");
        el.id = `deltacord-${id}`;
        styles.set(id, el);
        const sheet = el;
        whenHeadExists(() => document.head.append(sheet));
    }
    el.textContent = css;
}

export function removeStyle(id: string) {
    styles.get(id)?.remove();
    styles.delete(id);
}
