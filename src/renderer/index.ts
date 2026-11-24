// Deltacord inside the page. Runs before Discord's own code.
import { startWatching } from "./core/modules";

// First, before anything else: watch for Discord's modules as they load.
startWatching();

import type { ScreenSource, UpdateStatus } from "../shared/ipc";
import { discordReady } from "./core/discord";
import { logger } from "./core/logger";
import * as modules from "./core/modules";
import { Native, VERSION } from "./core/native";
import { plugins, startEnabledPlugins } from "./core/plugins";
import { applyQuickCss } from "./core/quickCss";
import { core } from "./core/settings";
import { setStyle } from "./core/styles";
import "./plugins";
import { splashReadyWhen, startSplash } from "./splash";
import { loadFont } from "./ui/font";
import { pickScreen } from "./ui/screenPicker";
import { openSettings } from "./ui/settingsPanel";
import { toast } from "./ui/toast";
import uiCss from "./ui/ui.css";

const log = logger("Core");
log.info(`Deltacord ${VERSION} starting`);

setStyle("ui", uiCss);
void loadFont();

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
Native.on("deltacord:update-status", status => {
    const s = status as UpdateStatus;
    if (s.state === "ready") toast(`* Deltacord ${s.version} is ready.`, { label: "Restart now", run: () => void Native.installUpdate() }, 15000);
    else if (s.state === "downloading") toast(`* Downloading Deltacord ${s.version}...`);
    else if (s.state === "error") toast(`* Couldn't update: ${s.message}`);
});

// For poking at Deltacord from the developer tools.
Object.defineProperty(window, "Deltacord", { value: { version: VERSION, plugins, modules, openSettings }, configurable: true });
