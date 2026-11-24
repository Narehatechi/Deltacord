// Builds Deltacord into dist/: the main process, the preload bridge and the renderer that runs inside Discord.
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const define = { __DELTACORD_VERSION__: JSON.stringify(version) };

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist/assets", { recursive: true });

const common = { bundle: true, sourcemap: "linked", logLevel: "info", define, legalComments: "none" };

await Promise.all([
    build({
        ...common,
        entryPoints: ["src/main/index.ts"],
        outfile: "dist/main.js",
        platform: "node",
        format: "cjs",
        target: "node22",
        external: ["electron", "electron-updater"]
    }),
    build({
        ...common,
        entryPoints: ["src/preload/index.ts"],
        outfile: "dist/preload.js",
        platform: "node",
        format: "cjs",
        target: "node22",
        external: ["electron"]
    }),
    build({
        ...common,
        entryPoints: ["src/renderer/index.ts"],
        outfile: "dist/renderer.js",
        platform: "browser",
        format: "iife",
        target: "chrome140",
        sourcemap: false,
        loader: { ".ttf": "base64", ".css": "text" }
    })
]);

cpSync("build/icon.png", "dist/assets/icon.png");
cpSync("build/icon.ico", "dist/assets/icon.ico");
