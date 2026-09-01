/**
 * Setting and its components -- 89 `new Setting(...)` sites, 68 of them in
 * vault-ai-setting-tab.ts alone.
 *
 * The surface is far narrower than the raw count suggests. Measured across every
 * call site, the only builder methods used are setName, setDesc, setHeading,
 * addText, addTextArea, addToggle, addDropdown, addButton, addColorPicker and
 * setTooltip -- no addSlider, addSearch, addExtraButton, addMomentFormat or setClass.
 * Components use onChange, setValue, setPlaceholder, setButtonText, onClick,
 * addOption, setCta, setWarning, setIcon, setDisabled and .inputEl.
 *
 * styles.css contains NO .setting-item rules -- Obsidian supplied all of them -- so
 * the layout CSS for these lives in theme/tokens.css, authored fresh.
 */
import { setIcon } from './set-icon';

/**
 * Base for the value-bearing components. Non-generic on purpose: every builder method
 * returns `this` for chaining, and a generic self-type fights TypeScript's `this`
 * narrowing in subclasses for no benefit at these call sites.
 */
abstract class ValueComponent<T> {
    disabled = false;
    protected changeCallback: ((value: T) => unknown) | null = null;

    abstract getValue(): T;

    onChange(callback: (value: T) => unknown): this {
        this.changeCallback = callback;
        return this;
    }

    setDisabled(disabled: boolean): this {
        this.disabled = disabled;
        return this;
    }
}

export class TextComponent extends ValueComponent<string> {
    readonly inputEl: HTMLInputElement;

    constructor(container: HTMLElement) {
        super();
        this.inputEl = container.createEl('input', { type: 'text', cls: 'setting-input' });
        this.inputEl.addEventListener('input', () => this.changeCallback?.(this.inputEl.value));
    }

    getValue(): string { return this.inputEl.value; }
    setValue(value: string): this { this.inputEl.value = value ?? ''; return this; }
    setPlaceholder(placeholder: string): this { this.inputEl.placeholder = placeholder; return this; }
    setDisabled(disabled: boolean): this { this.inputEl.disabled = disabled; this.disabled = disabled; return this; }
}

export class TextAreaComponent extends ValueComponent<string> {
    readonly inputEl: HTMLTextAreaElement;

    constructor(container: HTMLElement) {
        super();
        this.inputEl = container.createEl('textarea', { cls: 'setting-textarea' });
        this.inputEl.addEventListener('input', () => this.changeCallback?.(this.inputEl.value));
    }

    getValue(): string { return this.inputEl.value; }
    setValue(value: string): this { this.inputEl.value = value ?? ''; return this; }
    setPlaceholder(placeholder: string): this { this.inputEl.placeholder = placeholder; return this; }
    setDisabled(disabled: boolean): this { this.inputEl.disabled = disabled; this.disabled = disabled; return this; }
}

export class ToggleComponent extends ValueComponent<boolean> {
    readonly toggleEl: HTMLElement;
    private readonly input: HTMLInputElement;

    constructor(container: HTMLElement) {
        super();
        this.toggleEl = container.createDiv({ cls: 'checkbox-container' });
        this.input = this.toggleEl.createEl('input', { type: 'checkbox' });
        this.input.addEventListener('change', () => {
            this.toggleEl.toggleAttribute('data-checked', this.input.checked);
            this.changeCallback?.(this.input.checked);
        });
    }

    getValue(): boolean { return this.input.checked; }
    setValue(value: boolean): this {
        this.input.checked = Boolean(value);
        this.toggleEl.toggleAttribute('data-checked', this.input.checked);
        return this;
    }
    setDisabled(disabled: boolean): this { this.input.disabled = disabled; this.disabled = disabled; return this; }
}

export class DropdownComponent extends ValueComponent<string> {
    readonly selectEl: HTMLSelectElement;

    constructor(container: HTMLElement) {
        super();
        this.selectEl = container.createEl('select', { cls: 'dropdown' });
        this.selectEl.addEventListener('change', () => this.changeCallback?.(this.selectEl.value));
    }

    addOption(value: string, display: string): this {
        this.selectEl.createEl('option', { value, text: display });
        return this;
    }

    addOptions(options: Record<string, string>): this {
        for (const [value, display] of Object.entries(options)) this.addOption(value, display);
        return this;
    }

    getValue(): string { return this.selectEl.value; }
    setValue(value: string): this { this.selectEl.value = value; return this; }
    setDisabled(disabled: boolean): this { this.selectEl.disabled = disabled; this.disabled = disabled; return this; }
}

export class ButtonComponent {
    readonly buttonEl: HTMLButtonElement;

    constructor(container: HTMLElement) {
        this.buttonEl = container.createEl('button', { cls: 'setting-button' });
    }

    setButtonText(text: string): this { this.buttonEl.textContent = text; return this; }
    /** `mod-cta` is the one Obsidian theme class that appears in styles.css. */
    setCta(): this { this.buttonEl.addClass('mod-cta'); return this; }
    setWarning(): this { this.buttonEl.addClass('mod-warning'); return this; }
    setTooltip(tooltip: string): this { this.buttonEl.setAttribute('aria-label', tooltip); return this; }
    setIcon(icon: string): this { setIcon(this.buttonEl, icon); return this; }
    setDisabled(disabled: boolean): this { this.buttonEl.disabled = disabled; return this; }
    onClick(callback: (event: MouseEvent) => unknown): this {
        this.buttonEl.addEventListener('click', callback);
        return this;
    }
}

export class ColorComponent extends ValueComponent<string> {
    readonly inputEl: HTMLInputElement;

    constructor(container: HTMLElement) {
        super();
        this.inputEl = container.createEl('input', { type: 'color' });
        this.inputEl.addEventListener('input', () => this.changeCallback?.(this.inputEl.value));
    }

    getValue(): string { return this.inputEl.value; }
    setValue(value: string): this { this.inputEl.value = value; return this; }
}

export class Setting {
    readonly settingEl: HTMLElement;
    readonly infoEl: HTMLElement;
    readonly nameEl: HTMLElement;
    readonly descEl: HTMLElement;
    readonly controlEl: HTMLElement;

    constructor(containerEl: HTMLElement) {
        this.settingEl = containerEl.createDiv({ cls: 'setting-item' });
        this.infoEl = this.settingEl.createDiv({ cls: 'setting-item-info' });
        this.nameEl = this.infoEl.createDiv({ cls: 'setting-item-name' });
        this.descEl = this.infoEl.createDiv({ cls: 'setting-item-description' });
        this.controlEl = this.settingEl.createDiv({ cls: 'setting-item-control' });
    }

    setName(name: string | DocumentFragment): this {
        this.nameEl.setText(name);
        return this;
    }

    setDesc(desc: string | DocumentFragment): this {
        this.descEl.setText(desc);
        return this;
    }

    /** Renders as a section header rather than a labelled control row. */
    setHeading(): this {
        this.settingEl.addClass('setting-item-heading');
        return this;
    }

    setTooltip(tooltip: string): this {
        this.settingEl.setAttribute('aria-label', tooltip);
        return this;
    }

    setClass(cls: string): this {
        this.settingEl.addClass(cls);
        return this;
    }

    setDisabled(disabled: boolean): this {
        this.settingEl.toggleAttribute('data-disabled', disabled);
        return this;
    }

    addText(callback: (component: TextComponent) => unknown): this {
        callback(new TextComponent(this.controlEl));
        return this;
    }

    addTextArea(callback: (component: TextAreaComponent) => unknown): this {
        callback(new TextAreaComponent(this.controlEl));
        return this;
    }

    addToggle(callback: (component: ToggleComponent) => unknown): this {
        callback(new ToggleComponent(this.controlEl));
        return this;
    }

    addDropdown(callback: (component: DropdownComponent) => unknown): this {
        callback(new DropdownComponent(this.controlEl));
        return this;
    }

    addButton(callback: (component: ButtonComponent) => unknown): this {
        callback(new ButtonComponent(this.controlEl));
        return this;
    }

    addColorPicker(callback: (component: ColorComponent) => unknown): this {
        callback(new ColorComponent(this.controlEl));
        return this;
    }

    /** Obsidian allows chaining arbitrary work; used in a couple of places. */
    then(callback: (setting: this) => unknown): this {
        callback(this);
        return this;
    }
}

export abstract class PluginSettingTab {
    readonly containerEl: HTMLElement;

    constructor(readonly app: import('../app').App, readonly plugin: unknown) {
        this.containerEl = document.createElement('div');
        this.containerEl.addClass('vertical-tab-content');
    }

    abstract display(): void;

    hide(): void {
        this.containerEl.empty();
    }
}
