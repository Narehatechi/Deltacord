import { Native } from "../core/native";
import { definePlugin } from "../core/plugins";
import { pickFile } from "../ui/dom";
import { toast } from "../ui/toast";

const SOUND_KEY = "deltavoice-sound";
const MAX_BYTES = 2 * 1024 * 1024;
/** At this pitch an imported sound plays at its own speed. */
const BASE_PITCH = 450;

interface SavedSound {
    name: string;
    base64: string;
}

let audio: AudioContext | undefined;
let letters = 0;
let sound: { name: string; buffer: AudioBuffer; } | undefined;

const plugin = definePlugin({
    id: "deltavoice",
    name: "Deltavoice",
    description: "Plays a Deltarune style text voice as you type. Pick a built-in voice or import your own sound.",
    settings: {
        voice: {
            type: "select",
            label: "Voice",
            description: "\"My sound\" plays the sound you import below.",
            default: "square",
            options: [
                { label: "Classic", value: "square" },
                { label: "Soft", value: "triangle" },
                { label: "Gruff", value: "sawtooth" },
                { label: "Gentle", value: "sine" },
                { label: "My sound", value: "custom" }
            ]
        },
        pitch: { type: "slider", label: "Pitch", description: "For your own sound, 450 plays it as recorded.", default: BASE_PITCH, min: 150, max: 900, step: 10, unit: " Hz" },
        wobble: { type: "slider", label: "Pitch wobble", description: "How much each blip varies, so it sounds less robotic.", default: 4, min: 0, max: 20, step: 1, unit: "%" },
        volume: { type: "slider", label: "Volume", default: 35, min: 0, max: 100, step: 5, unit: "%" },
        every: { type: "slider", label: "Blip every", description: "How many letters between blips.", default: 2, min: 1, max: 4, step: 1, unit: " letters" }
    },
    actions: [
        { label: "Import a sound", run: () => void importSound() },
        { label: "Test", run: test },
        { label: "Remove my sound", run: removeSound }
    ],
    start() {
        document.addEventListener("keydown", onKeyDown, true);
        void loadSound();
    },
    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        void audio?.close();
        audio = undefined;
        sound = undefined;
    }
});

const context = () => audio ??= new AudioContext();

function toBase64(bytes: Uint8Array) {
    let text = "";
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
}

const fromBase64 = (base64: string) => Uint8Array.from(atob(base64), c => c.charCodeAt(0)).buffer;

/** Decodes a saved sound into something the browser can play. Throws if it isn't audio. */
async function decode(saved: SavedSound) {
    const buffer = await context().decodeAudioData(fromBase64(saved.base64));
    return { name: saved.name, buffer };
}

async function loadSound() {
    const text = Native.data.get(SOUND_KEY);
    if (!text) return;
    try {
        sound = await decode(JSON.parse(text) as SavedSound);
    } catch {
        sound = undefined;
        toast("* Deltavoice couldn't play your saved sound. Import it again.");
    }
}

async function importSound() {
    const file = await pickFile("audio/*,.wav,.mp3,.ogg,.oga,.flac,.m4a,.webm");
    if (!file) return;
    if (file.size > MAX_BYTES) return toast("* That sound is too big. Pick one under 2 MB; a short blip works best.");

    const saved: SavedSound = { name: file.name, base64: toBase64(new Uint8Array(await file.arrayBuffer())) };
    try {
        sound = await decode(saved);
    } catch {
        return toast("* That file couldn't be played. Try a WAV, MP3 or OGG.");
    }
    await Native.data.set(SOUND_KEY, JSON.stringify(saved));
    plugin.store.voice = "custom";
    toast(`* ${file.name} is your voice now.`);
    test();
}

function removeSound() {
    if (!sound) return toast("* You haven't imported a sound.");
    sound = undefined;
    void Native.data.set(SOUND_KEY, "");
    if (plugin.store.voice === "custom") plugin.store.voice = "square";
    toast("* Your sound is gone. Back to the Classic voice.");
}

function blip() {
    const ctx = context();
    const { voice, pitch, volume, wobble } = plugin.store;
    const now = ctx.currentTime;
    const vary = 1 + (Math.random() * 2 - 1) * wobble / 100;
    const gain = ctx.createGain();
    gain.connect(ctx.destination);

    if (voice === "custom" && sound) {
        const source = ctx.createBufferSource();
        source.buffer = sound.buffer;
        source.playbackRate.value = pitch / BASE_PITCH * vary;
        gain.gain.value = volume / 100;
        source.connect(gain);
        source.start(now);
        return;
    }

    const osc = ctx.createOscillator();
    osc.type = (voice === "custom" ? "square" : voice) as OscillatorType;
    osc.frequency.value = pitch * vary;
    gain.gain.setValueAtTime(Math.max(0.0001, volume / 100 * 0.25), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain);
    osc.start(now);
    osc.stop(now + 0.07);
}

/** Plays a short line, as if typing "* Hello!" */
function test() {
    for (let i = 0; i < 6; i++) setTimeout(blip, i * 70);
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!(e.target instanceof HTMLElement) || !e.target.closest('[role="textbox"]')) return;
    if (letters++ % plugin.store.every === 0) blip();
}

export default plugin;
