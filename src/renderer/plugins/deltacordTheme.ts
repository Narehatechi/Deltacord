import { definePlugin } from "../core/plugins";
import { FONT_FAMILY, loadFont } from "../ui/font";

const PALETTES: Record<string, { accent: string; accentHover: string; }> = {
    darkWorld: { accent: "#ff8c1a", accentHover: "#ffa64d" },
    crimson: { accent: "#e0243a", accentHover: "#ff4d5e" }
};

const SELECTOR = ":root:root, .theme-dark.theme-dark, .theme-light.theme-light, .theme-darker.theme-darker, .theme-midnight.theme-midnight, .visual-refresh.visual-refresh";

function fontCss() {
    const stack = `"${FONT_FAMILY}", "gg sans", sans-serif`;
    return `${SELECTOR} {
    --font-primary: ${stack};
    --font-display: ${stack};
    --font-headline: ${stack};
    --font-code: "${FONT_FAMILY}", monospace;
}
body { font-family: var(--font-primary); }`;
}

function paletteCss({ accent, accentHover }: { accent: string; accentHover: string; }) {
    return `${SELECTOR} {
    --background-base-lowest: #000000;
    --background-base-lower: #050505;
    --background-base-lower-alt: #050505;
    --background-base-low: #0a0a0a;
    --background-surface-high: #101010;
    --background-surface-higher: #151515;
    --background-surface-highest: #1a1a1a;
    --background-primary: #000000;
    --background-secondary: #050505;
    --background-secondary-alt: #0a0a0a;
    --background-tertiary: #000000;
    --background-floating: #0a0a0a;
    --modal-background: #000000;
    --chat-background: #000000;
    --channeltextarea-background: #0a0a0a;
    --app-frame-background: #000000;
    --app-frame-border: rgba(255, 255, 255, 0.12);
    --background-modifier-hover: rgba(255, 255, 255, 0.06);
    --background-modifier-active: rgba(255, 255, 255, 0.1);
    --background-modifier-selected: rgba(255, 255, 255, 0.12);
    --background-modifier-accent: rgba(255, 255, 255, 0.25);
    --background-mod-subtle: rgba(255, 255, 255, 0.06);
    --background-mod-normal: rgba(255, 255, 255, 0.1);
    --background-mod-strong: rgba(255, 255, 255, 0.16);
    --background-mod-muted: rgba(255, 255, 255, 0.04);
    --border-faint: rgba(255, 255, 255, 0.12);
    --border-muted: rgba(255, 255, 255, 0.2);
    --border-subtle: rgba(255, 255, 255, 0.35);
    --border-normal: rgba(255, 255, 255, 0.55);
    --border-strong: #ffffff;
    --text-default: #ffffff;
    --text-normal: #ffffff;
    --text-strong: #ffffff;
    --text-subtle: #c8c8c8;
    --text-muted: #a0a0a0;
    --header-primary: #ffffff;
    --header-secondary: #c8c8c8;
    --text-link: ${accent};
    --text-brand: ${accent};
    --interactive-normal: #c8c8c8;
    --interactive-hover: #ffffff;
    --interactive-active: #ffffff;
    --interactive-muted: #5a5a5a;
    --interactive-icon-default: #c8c8c8;
    --interactive-icon-hover: #ffffff;
    --interactive-icon-active: #ffffff;
    --brand-500: ${accent};
    --brand-560: ${accentHover};
    --brand-experiment: ${accent};
    --brand-experiment-560: ${accentHover};
    --button-filled-brand-background: ${accent};
    --button-filled-brand-background-hover: ${accentHover};
    --scrollbar-auto-thumb: ${accent};
    --scrollbar-thin-thumb: ${accent};
}`;
}

export default definePlugin({
    id: "deltacordTheme",
    name: "Deltacord Theme",
    description: "Deltacord's look: black, white and orange (or red), in the Determination Mono font.",
    enabledByDefault: true,
    settings: {
        palette: {
            type: "select",
            label: "Colors",
            default: "darkWorld",
            options: [
                { label: "Dark World (black, white and orange)", value: "darkWorld" },
                { label: "Crimson (black, white and red)", value: "crimson" },
                { label: "Discord's own colors", value: "off" }
            ]
        },
        font: { type: "boolean", label: "Determination Mono everywhere", description: "Use the pixel font for all of Discord's text.", default: true }
    },
    css: s => (s.font ? fontCss() : "") + (PALETTES[s.palette] ? paletteCss(PALETTES[s.palette]) : ""),
    start() {
        void loadFont();
    }
});
