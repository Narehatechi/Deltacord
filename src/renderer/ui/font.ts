import fontBase64 from "../splash/DeterminationMono.ttf";

export const FONT_FAMILY = "Determination Mono";
export const FONT_DATA_URL = `data:font/ttf;base64,${fontBase64}`;

let loading: Promise<unknown> | undefined;

/** Makes Determination Mono available to the page (Deltacord's own UI, the animation and the theme). */
export function loadFont() {
    loading ??= (async () => {
        const bytes = Uint8Array.from(atob(fontBase64), c => c.charCodeAt(0));
        const face = new FontFace(FONT_FAMILY, bytes.buffer);
        document.fonts.add(face);
        return face.load();
    })().catch(err => console.error("[Deltacord] Couldn't load Determination Mono", err));
    return loading;
}
