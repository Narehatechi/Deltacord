import { h } from "./dom";

/** A full-window Deltacord dialog. Escape or the close button closes it. Returns a function that closes it. */
export function openModal(title: string, body: Node, opts: { wide?: boolean; onClose?(): void; } = {}) {
    const close = () => {
        document.removeEventListener("keydown", onKey, true);
        backdrop.remove();
        opts.onClose?.();
    };
    const onKey = (e: KeyboardEvent) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        close();
    };
    const backdrop = h("div", { class: "dc-backdrop", onmousedown: (e: MouseEvent) => { if (e.target === backdrop) close(); } },
        h("div", { class: `dc-modal${opts.wide ? " dc-wide" : ""}`, role: "dialog", "aria-label": title },
            h("div", { class: "dc-modal-head" },
                h("div", { class: "dc-modal-title" }, `* ${title}`),
                h("button", { class: "dc-close", type: "button", "aria-label": "Close", onclick: close }, "✕")
            ),
            h("div", { class: "dc-modal-body" }, body)
        )
    );
    document.addEventListener("keydown", onKey, true);
    document.body.append(backdrop);
    return close;
}
