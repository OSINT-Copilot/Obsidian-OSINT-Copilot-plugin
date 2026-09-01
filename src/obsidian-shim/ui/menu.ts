/**
 * Menu -- context menus. Only 3 `new Menu()` sites (map-view ×2, timeline-view ×1);
 * graph-view rolls its own with raw DOM and is untouched by this.
 */
import { setIcon } from './set-icon';

export class MenuItem {
    readonly dom: HTMLElement;
    private clickCallback: ((event: MouseEvent) => unknown) | null = null;

    constructor(container: HTMLElement, private readonly dismiss: () => void) {
        this.dom = container.createDiv({ cls: 'menu-item' });
        this.dom.addEventListener('click', (event) => {
            this.dismiss();
            this.clickCallback?.(event);
        });
    }

    setTitle(title: string | DocumentFragment): this {
        const titleEl = this.dom.createDiv({ cls: 'menu-item-title' });
        titleEl.setText(title);
        return this;
    }

    setIcon(icon: string | null): this {
        if (!icon) return this;
        const iconEl = this.dom.createDiv({ cls: 'menu-item-icon' });
        setIcon(iconEl, icon);
        this.dom.insertBefore(iconEl, this.dom.firstChild);
        return this;
    }

    setDisabled(disabled: boolean): this {
        this.dom.toggleAttribute('data-disabled', disabled);
        return this;
    }

    setSection(_section: string): this {
        return this;
    }

    onClick(callback: (event: MouseEvent) => unknown): this {
        this.clickCallback = callback;
        return this;
    }
}

export class Menu {
    readonly dom: HTMLElement;
    private dismissHandler: ((event: MouseEvent) => void) | null = null;

    constructor() {
        this.dom = document.createElement('div');
        this.dom.addClass('menu');
    }

    addItem(callback: (item: MenuItem) => unknown): this {
        callback(new MenuItem(this.dom, () => this.hide()));
        return this;
    }

    addSeparator(): this {
        this.dom.createDiv({ cls: 'menu-separator' });
        return this;
    }

    showAtMouseEvent(event: MouseEvent): this {
        return this.showAtPosition({ x: event.clientX, y: event.clientY });
    }

    showAtPosition(position: { x: number; y: number }): this {
        this.dom.setCssProps({
            position: 'fixed',
            left: `${position.x}px`,
            top: `${position.y}px`,
        });
        document.body.appendChild(this.dom);

        // Defer so the click that opened the menu does not immediately dismiss it.
        window.setTimeout(() => {
            this.dismissHandler = () => this.hide();
            document.addEventListener('click', this.dismissHandler, { once: true });
        }, 0);
        return this;
    }

    hide(): this {
        if (this.dismissHandler) {
            document.removeEventListener('click', this.dismissHandler);
            this.dismissHandler = null;
        }
        this.dom.remove();
        return this;
    }
}
