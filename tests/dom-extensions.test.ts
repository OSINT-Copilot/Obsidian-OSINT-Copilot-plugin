import { describe, it, expect, beforeAll } from 'vitest';
import { installDomExtensions } from '../src/obsidian-shim/dom/dom-extensions';

/**
 * Guards ~1,055 call sites. The partial patch in tests/setup.ts that this replaces
 * silently dropped attr/type/placeholder/value/title and supported only one of the
 * three createDiv call forms.
 */
describe('Obsidian DOM extensions', () => {
    beforeAll(() => installDomExtensions());

    const root = () => document.createElement('div');

    it('supports all three createDiv call forms', () => {
        const el = root();
        expect(el.createDiv().tagName).toBe('DIV');
        expect(el.createDiv('bare-class').classList.contains('bare-class')).toBe(true);
        expect(el.createDiv({ cls: 'obj-class', text: 'hi' }).textContent).toBe('hi');
        expect(el.children).toHaveLength(3);
    });

    it('applies every option key that appears at a real call site', () => {
        const input = root().createEl('input', {
            cls: ['a', 'b'],
            type: 'checkbox',
            placeholder: 'type here',
            value: 'v',
            title: 'tip',
            attr: { 'data-x': '1', 'aria-hidden': true, removed: null },
        });
        expect(input.classList.contains('a') && input.classList.contains('b')).toBe(true);
        expect(input.getAttribute('type')).toBe('checkbox');
        expect(input.getAttribute('placeholder')).toBe('type here');
        expect(input.value).toBe('v');
        expect(input.getAttribute('title')).toBe('tip');
        expect(input.getAttribute('data-x')).toBe('1');
        expect(input.getAttribute('aria-hidden')).toBe('true');
        expect(input.hasAttribute('removed')).toBe(false);
    });

    it('accepts multiple classes from a space-separated string', () => {
        expect(root().createDiv({ cls: 'one two' }).classList.length).toBe(2);
    });

    it('runs the callback with the created element, after insertion', () => {
        const parent = root();
        let seen: HTMLElement | null = null;
        const el = parent.createEl('span', { text: 'x' }, (e) => { seen = e; });
        expect(seen).toBe(el);
        expect(el.parentElement).toBe(parent);
    });

    it('prepend inserts first', () => {
        const parent = root();
        parent.createDiv({ cls: 'second' });
        parent.createDiv({ cls: 'first', prepend: true });
        expect(parent.firstElementChild?.classList.contains('first')).toBe(true);
    });

    it('empty() removes all children', () => {
        const el = root();
        el.createDiv(); el.createDiv();
        el.empty();
        expect(el.childNodes).toHaveLength(0);
    });

    it('setText replaces, appendText appends', () => {
        const el = root();
        el.setText('a');
        el.appendText('b');
        expect(el.textContent).toBe('ab');
    });

    it('class helpers ignore empty strings', () => {
        const el = root();
        el.addClass('x', '');
        expect(el.classList.length).toBe(1);
        expect(el.hasClass('x')).toBe(true);
        el.removeClass('x');
        expect(el.hasClass('x')).toBe(false);
    });

    it('setCssProps sets CSS custom properties, not just standard ones', () => {
        const el = root();
        el.setCssProps({ '--my-var': 'red', color: 'blue' });
        expect(el.style.getPropertyValue('--my-var')).toBe('red');
        expect(el.style.color).toBe('blue');
    });

    it('works on DocumentFragment too', () => {
        const frag = document.createDocumentFragment();
        expect(frag.createDiv({ cls: 'in-frag' }).classList.contains('in-frag')).toBe(true);
    });
});
