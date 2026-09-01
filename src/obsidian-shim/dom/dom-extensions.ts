/**
 * Obsidian's HTMLElement prototype extensions.
 *
 * These are monkey-patches Obsidian adds to HTMLElement, not standard DOM, and the
 * codebase uses them 1,055 times -- far too many to hand-edit, and mechanical enough
 * that a faithful shim is strictly cheaper than a rewrite.
 *
 * Only the 11 members actually used are implemented. Everything else Obsidian patches
 * on (toggleClass, setAttr, detach, onClickEvent, hide, show, setCssStyles,
 * createFragment, insertAfter, findAll, matchParent) has zero occurrences repo-wide.
 *
 * Call-site counts, and the exact option keys and call forms they use, were measured
 * rather than guessed:
 *   createEl 427 | createDiv 274 | setCssProps 139 | addClass 77 | empty 61
 *   createSpan 29 | removeClass 25 | setText 10 | appendText 3 | hasClass 2
 * Option keys: text 355, cls 319, type 50, placeholder 37, attr 9, value 7, title 4.
 * createDiv is called in three forms: object (174), bare class string (64), no-arg (35).
 */

export interface DomElementInfo {
    /** A single class, or several. */
    cls?: string | string[];
    text?: string | DocumentFragment;
    title?: string;
    /** input type, button type, etc. */
    type?: string;
    placeholder?: string;
    value?: string;
    href?: string;
    /** Arbitrary attributes; null/false removes. */
    attr?: Record<string, string | number | boolean | null>;
    /** Insert as the first child rather than appending. */
    prepend?: boolean;
}

declare global {
    interface HTMLElement {
        createEl<K extends keyof HTMLElementTagNameMap>(
            tag: K, o?: DomElementInfo | string, callback?: (el: HTMLElementTagNameMap[K]) => void,
        ): HTMLElementTagNameMap[K];
        createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
        createSpan(o?: DomElementInfo | string, callback?: (el: HTMLSpanElement) => void): HTMLSpanElement;
        empty(): void;
        setText(text: string | DocumentFragment): void;
        appendText(text: string): void;
        addClass(...classes: string[]): void;
        removeClass(...classes: string[]): void;
        hasClass(cls: string): boolean;
        setCssProps(props: Record<string, string>): void;
    }
    interface DocumentFragment {
        createEl<K extends keyof HTMLElementTagNameMap>(
            tag: K, o?: DomElementInfo | string, callback?: (el: HTMLElementTagNameMap[K]) => void,
        ): HTMLElementTagNameMap[K];
        createDiv(o?: DomElementInfo | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
        createSpan(o?: DomElementInfo | string, callback?: (el: HTMLSpanElement) => void): HTMLSpanElement;
    }
}

function applyInfo(el: HTMLElement, o?: DomElementInfo | string): void {
    if (o === undefined) return;
    // The bare-string form is a class name: createDiv("my-class").
    if (typeof o === 'string') {
        if (o) el.classList.add(...o.split(/\s+/).filter(Boolean));
        return;
    }

    if (o.cls) {
        const classes = Array.isArray(o.cls) ? o.cls : o.cls.split(/\s+/);
        const filtered = classes.filter(Boolean);
        if (filtered.length) el.classList.add(...filtered);
    }
    if (o.text !== undefined) {
        if (typeof o.text === 'string') el.textContent = o.text;
        else el.appendChild(o.text);
    }
    if (o.title !== undefined) el.setAttribute('title', o.title);
    if (o.type !== undefined) el.setAttribute('type', o.type);
    if (o.placeholder !== undefined) el.setAttribute('placeholder', o.placeholder);
    if (o.value !== undefined) {
        // value must go through the property for inputs, or the field renders empty.
        (el as HTMLInputElement).value = o.value;
        el.setAttribute('value', o.value);
    }
    if (o.href !== undefined) el.setAttribute('href', o.href);
    if (o.attr) {
        for (const [key, value] of Object.entries(o.attr)) {
            if (value === null || value === false) el.removeAttribute(key);
            else el.setAttribute(key, String(value));
        }
    }
}

function makeCreateEl(parent: Node) {
    return function createEl(tag: string, o?: DomElementInfo | string, callback?: (el: HTMLElement) => void): HTMLElement {
        const el = document.createElement(tag);
        applyInfo(el, o);
        if (typeof o === 'object' && o?.prepend && parent.firstChild) parent.insertBefore(el, parent.firstChild);
        else parent.appendChild(el);
        callback?.(el);
        return el;
    };
}

let installed = false;

/** Idempotent: safe to call from both the app entry and the test setup. */
export function installDomExtensions(): void {
    if (installed) return;
    installed = true;

    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const fragProto = DocumentFragment.prototype as unknown as Record<string, unknown>;

    for (const target of [proto, fragProto]) {
        target.createEl = function (this: Node, tag: string, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) {
            return makeCreateEl(this)(tag, o, cb);
        };
        target.createDiv = function (this: Node, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) {
            return makeCreateEl(this)('div', o, cb);
        };
        target.createSpan = function (this: Node, o?: DomElementInfo | string, cb?: (el: HTMLElement) => void) {
            return makeCreateEl(this)('span', o, cb);
        };
    }

    proto.empty = function (this: HTMLElement) {
        while (this.firstChild) this.removeChild(this.firstChild);
    };

    proto.setText = function (this: HTMLElement, text: string | DocumentFragment) {
        if (typeof text === 'string') {
            this.textContent = text;
        } else {
            this.textContent = '';
            this.appendChild(text);
        }
    };

    proto.appendText = function (this: HTMLElement, text: string) {
        this.appendChild(document.createTextNode(text));
    };

    proto.addClass = function (this: HTMLElement, ...classes: string[]) {
        const filtered = classes.filter(Boolean);
        if (filtered.length) this.classList.add(...filtered);
    };

    proto.removeClass = function (this: HTMLElement, ...classes: string[]) {
        const filtered = classes.filter(Boolean);
        if (filtered.length) this.classList.remove(...filtered);
    };

    proto.hasClass = function (this: HTMLElement, cls: string) {
        return this.classList.contains(cls);
    };

    /**
     * Obsidian sets custom properties as well as standard ones, so this must go
     * through setProperty rather than the CSSStyleDeclaration camelCase surface --
     * `--my-var` is not settable as a property. graph-view alone uses this 86 times.
     */
    proto.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
        for (const [key, value] of Object.entries(props)) {
            this.style.setProperty(key, value);
        }
    };
}
