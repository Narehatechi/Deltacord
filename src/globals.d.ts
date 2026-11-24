declare const __DELTACORD_VERSION__: string;

declare module "*.ttf" {
    const base64: string;
    export default base64;
}

declare module "*.css" {
    const css: string;
    export default css;
}
