import { Native } from "./native";
import { core } from "./settings";
import { removeStyle, setStyle } from "./styles";

/** Applies (or removes) the user's QuickCSS. It goes last, so it can override anything. */
export function applyQuickCss() {
    if (!core("useQuickCss")) return removeStyle("quickcss");
    setStyle("quickcss", Native.quickCss.get());
}
