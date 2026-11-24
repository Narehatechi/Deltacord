import type { ScreenSource } from "../../shared/ipc";
import { Native } from "../core/native";
import { button, h, row, toggle } from "./dom";
import { openModal } from "./modal";

/** Deltacord's own screen share picker. Discord asks; this window answers with the chosen screen or window. */
export function pickScreen(pickId: number, sources: ScreenSource[], canShareAudio: boolean) {
    let chosen: string | null = sources.find(s => s.isScreen)?.id ?? sources[0]?.id ?? null;
    let audio = false;
    let answered = false;
    const answer = (sourceId: string | null) => {
        if (answered) return;
        answered = true;
        Native.screenPicked(pickId, sourceId, audio);
        close();
    };

    const tiles = sources.map(s => {
        const tile = h("button", { class: `dc-source${s.id === chosen ? " dc-active" : ""}`, type: "button", title: s.name },
            h("img", { src: s.thumbnail, alt: "" }),
            h("span", null, s.isScreen ? `Screen: ${s.name}` : s.name)
        );
        tile.addEventListener("click", () => {
            chosen = s.id;
            tiles.forEach(t => t.classList.toggle("dc-active", t === tile));
        });
        tile.addEventListener("dblclick", () => answer(s.id));
        return tile;
    });

    const body = h("div", null,
        h("div", { class: "dc-sources" }, tiles),
        canShareAudio && row("Share sound", "Also share what your computer is playing.", toggle(false, v => { audio = v; })),
        h("div", { class: "dc-buttons" },
            button("Go live", () => answer(chosen), "primary"),
            button("Cancel", () => answer(null))
        )
    );
    const close = openModal("Share your screen", body, { wide: true, onClose: () => answer(null) });
}
