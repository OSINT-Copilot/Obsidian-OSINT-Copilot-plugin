import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Notice } from '../src/obsidian-shim/ui/notice';
import { Modal } from '../src/obsidian-shim/ui/modal';
import { Menu } from '../src/obsidian-shim/ui/menu';
import { Setting } from '../src/obsidian-shim/ui/setting';
import { MarkdownRenderer } from '../src/obsidian-shim/ui/markdown-renderer';
import { installDomExtensions } from '../src/obsidian-shim/dom/dom-extensions';

installDomExtensions();

beforeEach(() => { document.body.innerHTML = ''; });

describe('Notice', () => {
    it('renders into a shared container and auto-dismisses', () => {
        vi.useFakeTimers();
        new Notice('saved', 1000);
        expect(document.querySelector('.notice')?.textContent).toBe('saved');
        vi.advanceTimersByTime(1000);
        expect(document.querySelector('.notice')).toBeNull();
        vi.useRealTimers();
    });

    it('duration 0 stays until dismissed', () => {
        vi.useFakeTimers();
        const notice = new Notice('sticky', 0);
        vi.advanceTimersByTime(60_000);
        expect(document.querySelector('.notice')).not.toBeNull();
        notice.hide();
        expect(document.querySelector('.notice')).toBeNull();
        vi.useRealTimers();
    });
});

describe('Modal', () => {
    it('exposes contentEl and a .modal-bg element', () => {
        // confirm-modal.ts does containerEl.querySelector('.modal-bg') to defeat
        // click-outside-to-close, so this element must exist under that class.
        const modal = new Modal(null as never);
        expect(modal.containerEl.querySelector('.modal-bg')).not.toBeNull();
        expect(modal.contentEl.classList.contains('modal-content')).toBe(true);
    });

    it('open/close attach and detach, and Escape closes', () => {
        const modal = new Modal(null as never);
        modal.open();
        expect(document.body.contains(modal.containerEl)).toBe(true);

        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(document.body.contains(modal.containerEl)).toBe(false);
    });

    it('calls onOpen and onClose hooks', () => {
        const onOpen = vi.fn();
        const onClose = vi.fn();
        class Sub extends Modal { onOpen() { onOpen(); } onClose() { onClose(); } }
        const modal = new Sub(null as never);
        modal.open();
        modal.close();
        expect(onOpen).toHaveBeenCalledOnce();
        expect(onClose).toHaveBeenCalledOnce();
    });
});

describe('Setting', () => {
    it('builds the row structure and chains', () => {
        const container = document.createElement('div');
        const setting = new Setting(container).setName('Name').setDesc('Desc');
        expect(setting.nameEl.textContent).toBe('Name');
        expect(setting.descEl.textContent).toBe('Desc');
        expect(container.querySelector('.setting-item')).not.toBeNull();
    });

    it('addText wires value and onChange', () => {
        const container = document.createElement('div');
        const changes: string[] = [];
        new Setting(container).addText((t) => t.setPlaceholder('p').setValue('a').onChange((v) => changes.push(v)));

        const input = container.querySelector('input') as HTMLInputElement;
        expect(input.value).toBe('a');
        expect(input.placeholder).toBe('p');
        input.value = 'b';
        input.dispatchEvent(new Event('input'));
        expect(changes).toEqual(['b']);
    });

    it('addToggle wires checked state', () => {
        const container = document.createElement('div');
        const changes: boolean[] = [];
        new Setting(container).addToggle((t) => t.setValue(true).onChange((v) => changes.push(v)));

        const input = container.querySelector('input[type=checkbox]') as HTMLInputElement;
        expect(input.checked).toBe(true);
        input.checked = false;
        input.dispatchEvent(new Event('change'));
        expect(changes).toEqual([false]);
    });

    it('addDropdown adds options and reports selection', () => {
        const container = document.createElement('div');
        const changes: string[] = [];
        new Setting(container).addDropdown((d) =>
            d.addOption('a', 'A').addOption('b', 'B').setValue('b').onChange((v) => changes.push(v)));

        const select = container.querySelector('select') as HTMLSelectElement;
        expect(select.options).toHaveLength(2);
        expect(select.value).toBe('b');
        select.value = 'a';
        select.dispatchEvent(new Event('change'));
        expect(changes).toEqual(['a']);
    });

    it('addButton supports setCta and onClick', () => {
        const container = document.createElement('div');
        const clicked = vi.fn();
        new Setting(container).addButton((b) => b.setButtonText('Go').setCta().onClick(clicked));

        const button = container.querySelector('button') as HTMLButtonElement;
        expect(button.textContent).toBe('Go');
        expect(button.classList.contains('mod-cta')).toBe(true);
        button.click();
        expect(clicked).toHaveBeenCalledOnce();
    });

    it('setHeading marks the row as a section header', () => {
        const container = document.createElement('div');
        new Setting(container).setName('Section').setHeading();
        expect(container.querySelector('.setting-item-heading')).not.toBeNull();
    });
});

describe('Menu', () => {
    it('renders items and dismisses on click', () => {
        vi.useFakeTimers();
        const chosen = vi.fn();
        const menu = new Menu();
        menu.addItem((i) => i.setTitle('Open note').setIcon('file-text').onClick(chosen));
        menu.showAtPosition({ x: 10, y: 20 });

        expect(document.querySelector('.menu-item-title')?.textContent).toBe('Open note');
        (document.querySelector('.menu-item') as HTMLElement).click();
        expect(chosen).toHaveBeenCalledOnce();
        expect(document.querySelector('.menu')).toBeNull();
        vi.useRealTimers();
    });
});

describe('MarkdownRenderer', () => {
    const render = async (markdown: string) => {
        const el = document.createElement('div');
        await MarkdownRenderer.render(null, markdown, el, '', null);
        return el;
    };

    it('renders common markdown', async () => {
        const el = await render('# Title\n\n- one\n- two\n\n**bold** and `code`');
        expect(el.querySelector('h1')?.textContent).toBe('Title');
        expect(el.querySelectorAll('li')).toHaveLength(2);
        expect(el.querySelector('strong')?.textContent).toBe('bold');
        expect(el.querySelector('code')?.textContent).toBe('code');
    });

    it('renders wikilinks as internal links, honouring the display half', async () => {
        const el = await render('See [[OSINTCopilot/ftm/Company/Lukoil|Lukoil]].');
        const link = el.querySelector('a.internal-link') as HTMLAnchorElement;
        expect(link.textContent).toBe('Lukoil');
        expect(link.getAttribute('data-href')).toBe('OSINTCopilot/ftm/Company/Lukoil');
    });

    it('never produces executable elements or handlers from model output', async () => {
        // The renderer's input is LLM and enricher output; treat it as hostile.
        // With html:false these are escaped to visible TEXT, which is safe -- so assert
        // on the resulting DOM rather than on a substring of innerHTML.
        const el = await render('<script>alert(1)</script>\n\n<img src=x onerror="alert(2)">');
        expect(el.querySelector('script')).toBeNull();
        expect(el.querySelector('img')).toBeNull();
        for (const node of Array.from(el.querySelectorAll('*'))) {
            for (const attr of Array.from(node.attributes)) {
                expect(attr.name.toLowerCase().startsWith('on')).toBe(false);
            }
        }
    });

    it('does not pass raw HTML through', async () => {
        const el = await render('<b>not bold</b>');
        expect(el.querySelector('b')).toBeNull();
    });
});
