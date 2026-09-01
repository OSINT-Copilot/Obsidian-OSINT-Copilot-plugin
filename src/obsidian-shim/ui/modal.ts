/**
 * Modal -- 16 subclasses across the codebase.
 *
 * The used surface is tiny: constructor(app), .open(), .close(), this.contentEl,
 * and occasionally .titleEl / .containerEl / .setTitle(). No .scope, no modalEl
 * manipulation.
 *
 * `.modal-bg` is not decoration: confirm-modal.ts reaches for
 * containerEl.querySelector('.modal-bg') to defeat click-outside-to-close, so the
 * element must exist with that class.
 */
export class Modal {
    readonly containerEl: HTMLElement;
    readonly modalEl: HTMLElement;
    readonly titleEl: HTMLElement;
    readonly contentEl: HTMLElement;
    private readonly bgEl: HTMLElement;
    private keyHandler: ((event: KeyboardEvent) => void) | null = null;
    private previouslyFocused: Element | null = null;

    constructor(readonly app: import('../app').App) {
        this.containerEl = document.createElement('div');
        this.containerEl.addClass('modal-container');

        this.bgEl = this.containerEl.createDiv({ cls: 'modal-bg' });
        this.modalEl = this.containerEl.createDiv({ cls: 'modal' });
        this.titleEl = this.modalEl.createDiv({ cls: 'modal-title' });
        this.contentEl = this.modalEl.createDiv({ cls: 'modal-content' });

        const closeButton = this.modalEl.createDiv({ cls: 'modal-close-button' });
        closeButton.addEventListener('click', () => this.close());
        this.bgEl.addEventListener('click', () => this.close());
    }

    setTitle(title: string): this {
        this.titleEl.setText(title);
        return this;
    }

    open(): void {
        this.previouslyFocused = document.activeElement;
        document.body.appendChild(this.containerEl);

        this.keyHandler = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                this.close();
            }
        };
        document.addEventListener('keydown', this.keyHandler);

        this.onOpen();
        // Focus the first focusable control so keyboard users land inside the dialog.
        const focusable = this.modalEl.querySelector<HTMLElement>(
            'input, textarea, select, button, [tabindex]:not([tabindex="-1"])',
        );
        focusable?.focus();
    }

    close(): void {
        if (this.keyHandler) {
            document.removeEventListener('keydown', this.keyHandler);
            this.keyHandler = null;
        }
        this.onClose();
        this.containerEl.remove();
        (this.previouslyFocused as HTMLElement | null)?.focus?.();
    }

    onOpen(): void { /* subclasses override */ }
    onClose(): void { /* subclasses override */ }
}
