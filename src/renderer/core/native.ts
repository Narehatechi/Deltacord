import type { DeltacordNativeApi } from "../../preload";

declare global {
    interface Window {
        DeltacordNative: DeltacordNativeApi;
    }
}

export const Native = window.DeltacordNative;
export const VERSION = __DELTACORD_VERSION__;
