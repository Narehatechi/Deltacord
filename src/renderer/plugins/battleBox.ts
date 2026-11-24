import { definePlugin } from "../core/plugins";

/*
 * Battle Box: Discord in the style of Deltacord's own windows. Square corners everywhere, black boxes
 * with white borders, menus that light up in the accent color.
 *
 * Most of it rests on things that survive Discord updates: its corner-radius variables and the
 * accessibility roles on menus, tooltips and lists. A few parts use Discord's current class names
 * (chat box, dialogs, embeds, pop-outs); if Discord renames those, only those parts fall back to
 * Discord's look.
 */

const SELECTOR = ":root:root, .theme-dark.theme-dark, .theme-light.theme-light, .theme-darker.theme-darker, .theme-midnight.theme-midnight, .visual-refresh.visual-refresh";

const MENUS = `[role="menu"], .menu_M3qk4j, [role="listbox"]`;
const TOOLTIPS = `[role="tooltip"], .tooltip_ZDdyhE, .tooltip_3_v8qp`;
const DIALOGS = `.root__KoJTP, .modal__F9ieB, .popout_j5xNzb, .outer_P1YEjQ`;
const HOVERED = `[role^="menuitem"]:hover, [role^="menuitem"]:focus-visible, [role^="menuitem"][class*="focused"], [role="option"][aria-selected="true"], [role="option"]:hover`;

function css(s: { border: number; pills: boolean; chatBox: boolean; tooltipsFont: boolean; }) {
    const w = `${s.border}px`;
    return `
${SELECTOR} {
    --radius-xs: 0px;
    --radius-sm: 0px;
    --radius-md: 0px;
    --radius-lg: 0px;
    --radius-xl: 0px;
    --radius-xxl: 0px;
    ${s.pills ? "--radius-round: 0px;" : ""}
}

${MENUS}, ${TOOLTIPS}, ${DIALOGS} {
    border: ${w} solid #fff !important;
    border-radius: 0 !important;
    box-shadow: 0 0 0 2px #000, 0 10px 30px rgb(0 0 0 / 0.6) !important;
}
${MENUS}, ${TOOLTIPS} {
    background: #000 !important;
}
${TOOLTIPS} {
    color: #fff !important;
    ${s.tooltipsFont ? "font-family: \"Determination Mono\", monospace !important;" : ""}
}

[role^="menuitem"], [role="option"] {
    border-radius: 0 !important;
}
${HOVERED} {
    background: var(--dc-accent, #b48cff) !important;
    color: #000 !important;
}
:is(${HOVERED}) * {
    color: #000 !important;
}

${s.chatBox ? `
.channelTextArea_z_gUBg, form [class*="channelTextArea_"] {
    border: ${w} solid #fff !important;
    border-radius: 0 !important;
}` : ""}

.embedFull_XyW1ZT, article[class*="embedFull_"] {
    border: 1px solid rgb(255 255 255 / 0.35) !important;
    border-left: 4px solid var(--dc-accent, #b48cff) !important;
    border-radius: 0 !important;
}

pre, code, .hljs {
    border-radius: 0 !important;
}
pre {
    border: 1px solid rgb(255 255 255 / 0.35) !important;
}

input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), textarea, select {
    border-radius: 0 !important;
}

::-webkit-scrollbar-thumb, ::-webkit-scrollbar-track {
    border-radius: 0 !important;
}
`;
}

export default definePlugin({
    id: "battleBox",
    name: "Battle Box",
    description: "A theme that makes Discord look like Deltacord's own windows: square corners, black boxes with white borders, and menus that light up in your accent color. Works with any Deltacord Theme colors.",
    settings: {
        border: { type: "slider", label: "Border thickness", default: 2, min: 1, max: 4, step: 1, unit: " px" },
        pills: { type: "boolean", label: "Square pills too", description: "Make rounded pill shapes, like some buttons and badges, square as well.", default: true },
        chatBox: { type: "boolean", label: "Box around the message box", default: true },
        tooltipsFont: { type: "boolean", label: "Pixel font in tooltips", default: true }
    },
    css
});
