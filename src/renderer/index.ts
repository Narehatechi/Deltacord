// Deltacord inside the page. Runs before Discord's own code.
import { startWatching } from "./core/modules";

// First, before anything else: watch for Discord's modules as they load.
startWatching();

import type { ScreenSource } from "../shared/ipc";
import { discordReady } from "./core/discord";
import { logger } from "./core/logger";
import * as modules from "./core/modules";
import { Native, VERSION } from "./core/native";
import { plugins, startEnabledPlugins } from "./core/plugins";
import { applyQuickCss } from "./core/quickCss";
import { core } from "./core/settings";
import "./core/updates";
import { setStyle } from "./core/styles";
import "./plugins";
import { splashReadyWhen, startSplash } from "./splash";
import { loadFont } from "./ui/font";
import { setUpContextMenu } from "./ui/contextMenu";
import { pickScreen } from "./ui/screenPicker";
import { setUpTitleBar } from "./ui/titleBar";
import { openSettings } from "./ui/settingsPanel";
import uiCss from "./ui/ui.css";

const log = logger("Core");
log.info(`Deltacord ${VERSION} starting`);

setStyle("ui", uiCss);
void loadFont();
setUpTitleBar();
setUpContextMenu();

if (core("startupAnimation")) {
    startSplash(core("startupStyle"));
    splashReadyWhen(discordReady);
}

function whenDomReady(run: () => void) {
    if (document.readyState !== "loading") run();
    else document.addEventListener("DOMContentLoaded", run, { once: true });
}

whenDomReady(() => {
    startEnabledPlugins();
    applyQuickCss();
});

Native.on("deltacord:open-settings", () => whenDomReady(() => openSettings()));
Native.on("deltacord:pick-screen", (pickId, sources, canShareAudio) =>
    pickScreen(pickId as number, sources as ScreenSource[], canShareAudio as boolean));

// For poking at Deltacord from the developer tools.
Object.defineProperty(window, "Deltacord", { value: { version: VERSION, plugins, modules, openSettings }, configurable: true });
