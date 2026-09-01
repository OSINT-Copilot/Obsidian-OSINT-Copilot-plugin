/**
 * Notice -- 233 call sites, the single most-used Obsidian symbol.
 *
 * Obsidian's is a stacked, auto-dismissing toast in the top-right. Callers only ever
 * use `new Notice(message, duration?)` and occasionally `.hide()`, so that is all
 * this implements.
 */
const DEFAULT_DURATION_MS = 5000;
const CONTAINER_ID = 'osint-notice-container';

function container(): HTMLElement {
    let el = document.getElementById(CONTAINER_ID);
    if (!el) {
        el = document.createElement('div');
        el.id = CONTAINER_ID;
        el.className = 'notice-container';
        document.body.appendChild(el);
    }
    return el;
}

export class Notice {
    readonly noticeEl: HTMLElement;
    private timer: number | null = null;

    constructor(message: string | DocumentFragment, duration = DEFAULT_DURATION_MS) {
        this.noticeEl = document.createElement('div');
        this.noticeEl.className = 'notice';
        this.setMessage(message);
        container().appendChild(this.noticeEl);

        this.noticeEl.addEventListener('click', () => this.hide());
        // duration 0 means "stay until dismissed" in Obsidian.
        if (duration > 0) {
            this.timer = window.setTimeout(() => this.hide(), duration);
        }
    }

    setMessage(message: string | DocumentFragment): this {
        if (typeof message === 'string') this.noticeEl.textContent = message;
        else {
            this.noticeEl.textContent = '';
            this.noticeEl.appendChild(message);
        }
        return this;
    }

    hide(): void {
        if (this.timer !== null) {
            window.clearTimeout(this.timer);
            this.timer = null;
        }
        this.noticeEl.remove();
    }
}
