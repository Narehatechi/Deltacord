# Deltacord

Deltacord is a Discord app of its own for Windows, with a Deltarune soul. It opens Discord in its own window, so you don't need the regular Discord app, and adds a startup animation, its own look, plugins and settings on top.

Every line of Deltacord is its own. It isn't a fork of Discord's app, Vencord, Equicord or any other client.

## Download

**[Download Deltacord-Setup.exe](https://github.com/Narehatechi/deltacord/releases/latest/download/Deltacord-Setup.exe)**

Double-click it and Deltacord installs and opens. Log in like you would on discord.com. If Windows says it protected your PC, click **More info**, then **Run anyway**; the installer isn't code-signed yet.

Deltacord updates itself. When an update is ready it tells you, and installs the next time it restarts.

## What's in it

- **Startup animation.** DEL, TA, CORD in Determination Mono, in fourteen styles, the same as Deltacord on Android. It stays until Discord is ready.
- **Deltacord Theme** (on by default): black, white and orange, or red with Crimson, with Determination Mono for all text.
- **Deltavoice**: a Deltarune style text voice as you type. Pick a built-in voice or import your own sound (WAV, MP3, OGG and more), and set its pitch, wobble and volume.
- **Deltalogger**: keeps deleted messages, every edit and ghost pings, even after a restart, in a searchable log (Ctrl+Alt+L).
- **TensionBar**: a TP gauge above the message box that fills as you near the length limit.
- **QuickCSS**: your own CSS on top of everything.
- **Packs**: save your plugins, their settings, your QuickCSS and your Deltavoice sound as one `.deltapack` file to share or back up.
- **Its own screen share picker**, with an option to share your computer's sound.
- **Runs in the tray** so you keep getting messages with the window closed.

Open Deltacord Settings with **Ctrl+Alt+D**, from the tray icon, or from the Deltacord menu (press Alt to show the menu bar).

## How it works

- `src/main`: the app itself (Electron). It opens discord.com in a window, keeps your settings in `%APPDATA%\Deltacord Desktop`, runs the tray and menu, answers screen share requests and handles updates.
- `src/preload`: the only bridge between the page and the app. The page gets a small list of things it may ask for and nothing else.
- `src/renderer`: Deltacord inside the page. `core/modules.ts` finds Discord's stores and event dispatcher as Discord loads, and is written so it can never throw into Discord's own loading. `core/plugins.ts` is the plugin system; plugins live in `plugins/`.

### Writing a plugin

```ts
import { definePlugin } from "../core/plugins";

const plugin = definePlugin({
    id: "hello",
    name: "Hello",
    description: "Says hello when a message arrives.",
    settings: {
        loud: { type: "boolean", label: "Be loud", default: false }
    },
    flux: {
        MESSAGE_CREATE(event) {
            console.log(plugin.store.loud ? "HELLO!" : "hello", event.message);
        }
    }
});

export default plugin;
```

Import it from `src/renderer/plugins/index.ts`. Plugins can also add CSS (`css`), buttons on their card (`actions`), and `start` and `stop` code.

## Building

You need Node.js 22.

```sh
npm install
npm run typecheck
npm run build
npm start        # run it
npm run dist     # make Deltacord-Setup.exe in release/
```

Every push to `main` builds the installer on GitHub and publishes it as a new release, which is what installed copies update from.

## Credits and license

Deltacord is by Narehatechi and released under the MIT License (see `LICENSE`).

Determination Mono is by Abacadaba, based on 8-bit Operator by Grand Chaos Productions, and is included unchanged under CC BY-NC-ND (see `src/renderer/splash/DeterminationMono-LICENSE.txt`). Deltacord is free and non-commercial.

Deltacord isn't made by or affiliated with Discord. Using a modified client is against Discord's Terms of Service, so use it at your own risk.
