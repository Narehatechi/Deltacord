const STYLE = "background:#000;color:#b48cff;font-weight:bold;padding:1px 4px;border:1px solid #b48cff";

export function logger(area: string) {
    const tag = `%cDeltacord%c ${area}`;
    return {
        info: (...args: unknown[]) => console.log(tag, STYLE, "", ...args),
        warn: (...args: unknown[]) => console.warn(tag, STYLE, "", ...args),
        error: (...args: unknown[]) => console.error(tag, STYLE, "", ...args)
    };
}
