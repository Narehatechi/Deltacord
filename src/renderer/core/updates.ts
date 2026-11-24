import type { UpdateStatus } from "../../shared/ipc";
import { toast } from "../ui/toast";
import { Native, VERSION } from "./native";

let status: UpdateStatus = { state: "idle" };
try {
    status = Native.updateState();
} catch {
    status = { state: "idle" };
}

const listeners = new Set<(s: UpdateStatus) => void>();
let announced = "";

export const updateStatus = () => status;

export function onUpdateStatus(fn: (s: UpdateStatus) => void) {
    listeners.add(fn);
    return () => void listeners.delete(fn);
}

/** One line describing where updates stand, for the settings page. */
export function describeUpdate(s: UpdateStatus = status) {
    switch (s.state) {
        case "checking": return "Checking for updates...";
        case "none": return `You're on the newest version, ${VERSION}.`;
        case "downloading": return `Downloading Deltacord ${s.version}: ${s.percent}%`;
        case "ready": return `Deltacord ${s.version} is downloaded and ready.`;
        case "error": return `Couldn't check for updates: ${s.message}`;
        default: return `Deltacord ${VERSION}`;
    }
}

export const restartToUpdate = () => void Native.installUpdate();

Native.on("deltacord:update-status", next => {
    status = next as UpdateStatus;
    listeners.forEach(fn => fn(status));

    const key = status.state === "ready" || status.state === "downloading" ? `${status.state}-${status.version}` : status.state;
    if (status.state === "ready" && announced !== key) {
        announced = key;
        toast(`* Deltacord ${status.version} is ready.`, { label: "Restart now", run: restartToUpdate }, 30_000);
    } else if (status.state === "downloading" && announced !== key) {
        announced = key;
        toast(`* Downloading Deltacord ${status.version}...`);
    } else if (status.state === "none" && status.manual) {
        toast(`* You're on the newest version, ${VERSION}.`);
    } else if (status.state === "error" && status.manual) {
        toast(`* Couldn't check for updates: ${status.message}`);
    }
});
