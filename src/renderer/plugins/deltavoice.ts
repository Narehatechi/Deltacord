import { definePlugin } from "../core/plugins";

let audio: AudioContext | undefined;
let letters = 0;

const plugin = definePlugin({
    id: "deltavoice",
    name: "Deltavoice",
    description: "Plays a Deltarune style text voice as you type.",
    settings: {
        voice: {
            type: "select",
            label: "Voice",
            default: "square",
            options: [
                { label: "Classic", value: "square" },
                { label: "Soft", value: "triangle" },
                { label: "Gruff", value: "sawtooth" },
                { label: "Gentle", value: "sine" }
            ]
        },
        pitch: { type: "slider", label: "Pitch", default: 450, min: 150, max: 900, step: 10, unit: " Hz" },
        volume: { type: "slider", label: "Volume", default: 35, min: 0, max: 100, step: 5, unit: "%" },
        every: { type: "slider", label: "Blip every", description: "How many letters between blips.", default: 2, min: 1, max: 4, step: 1, unit: " letters" }
    },
    start() {
        document.addEventListener("keydown", onKeyDown, true);
    },
    stop() {
        document.removeEventListener("keydown", onKeyDown, true);
        void audio?.close();
        audio = undefined;
    }
});

function blip() {
    audio ??= new AudioContext();
    const { voice, pitch, volume } = plugin.store;
    const now = audio.currentTime;
    const osc = audio.createOscillator();
    const gain = audio.createGain();
    osc.type = voice as OscillatorType;
    osc.frequency.value = pitch * (0.96 + Math.random() * 0.08);
    gain.gain.setValueAtTime(Math.max(0.0001, volume / 100 * 0.25), now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.06);
    osc.connect(gain).connect(audio.destination);
    osc.start(now);
    osc.stop(now + 0.07);
}

function onKeyDown(e: KeyboardEvent) {
    if (e.key.length !== 1 || e.key === " " || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!(e.target instanceof HTMLElement) || !e.target.closest('[role="textbox"]')) return;
    if (letters++ % plugin.store.every === 0) blip();
}

export default plugin;
