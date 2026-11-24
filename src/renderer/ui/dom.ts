type Child = Node | string | number | false | null | undefined | Child[];
type Props = Record<string, unknown> & { class?: string; style?: string; };

/** Builds an element: h("div", { class: "x", onclick: fn }, "text", child). */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props | null = null, ...children: Child[]): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(props ?? {})) {
        if (value == null || value === false) continue;
        if (key === "class") el.className = String(value);
        else if (key === "style") el.setAttribute("style", String(value));
        else if (key.startsWith("on") && typeof value === "function") el.addEventListener(key.slice(2), value as EventListener);
        else if (key in el && typeof value !== "string") (el as unknown as Record<string, unknown>)[key] = value;
        else el.setAttribute(key, value === true ? "" : String(value));
    }
    append(el, children);
    return el;
}

function append(el: Node, children: Child[]) {
    for (const child of children) {
        if (child == null || child === false) continue;
        if (Array.isArray(child)) append(el, child);
        else el.appendChild(typeof child === "object" ? child : document.createTextNode(String(child)));
    }
}

export function button(label: string, onclick: () => void, kind: "primary" | "secondary" | "danger" = "secondary") {
    return h("button", { class: `dc-button dc-${kind}`, type: "button", onclick }, label);
}

export function toggle(checked: boolean, onchange: (value: boolean) => void) {
    const input = h("input", { type: "checkbox", class: "dc-toggle-input", checked });
    input.addEventListener("change", () => onchange(input.checked));
    return h("label", { class: "dc-toggle" }, input, h("span", { class: "dc-toggle-track" }));
}

export function select(value: string, options: { label: string; value: string; }[], onchange: (value: string) => void) {
    const el = h("select", { class: "dc-select" }, options.map(o => h("option", { value: o.value, selected: o.value === value }, o.label)));
    el.addEventListener("change", () => onchange(el.value));
    return el;
}

export function slider(value: number, min: number, max: number, step: number, unit: string, onchange: (value: number) => void) {
    const label = h("span", { class: "dc-slider-value" }, `${value}${unit}`);
    const input = h("input", { type: "range", class: "dc-slider", min: String(min), max: String(max), step: String(step), value: String(value) });
    input.addEventListener("input", () => { label.textContent = `${input.value}${unit}`; });
    input.addEventListener("change", () => onchange(Number(input.value)));
    return h("div", { class: "dc-slider-row" }, input, label);
}

export function textInput(value: string, placeholder: string, onchange: (value: string) => void) {
    const el = h("input", { type: "text", class: "dc-input", value, placeholder });
    el.addEventListener("change", () => onchange(el.value));
    return el;
}

export function colorInput(value: string, onchange: (value: string) => void) {
    const el = h("input", { type: "color", class: "dc-color", value });
    el.addEventListener("change", () => onchange(el.value));
    return el;
}

/** A row in a settings list: label and description on the left, the control on the right. */
export function row(label: string, description: string | undefined, control: Node) {
    return h("div", { class: "dc-row" },
        h("div", { class: "dc-row-text" },
            h("div", { class: "dc-row-label" }, label),
            description && h("div", { class: "dc-row-description" }, description)
        ),
        control
    );
}

/** Starts a download of text as a file. */
export function downloadText(name: string, text: string, type = "application/json") {
    const url = URL.createObjectURL(new Blob([text], { type }));
    h("a", { href: url, download: name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** Asks for a file, or resolves null if none was picked. */
export function pickFile(accept: string): Promise<File | null> {
    return new Promise(resolve => {
        const input = h("input", { type: "file", accept, style: "display:none" });
        input.addEventListener("change", () => {
            const file = input.files?.[0] ?? null;
            input.remove();
            resolve(file);
        });
        input.addEventListener("cancel", () => { input.remove(); resolve(null); });
        document.body.append(input);
        input.click();
    });
}

/** Asks for a file and returns its text, or null if none was picked. */
export async function pickTextFile(accept: string): Promise<string | null> {
    const file = await pickFile(accept);
    return file ? file.text() : null;
}
