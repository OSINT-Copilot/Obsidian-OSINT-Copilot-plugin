/**
 * MarkdownRenderer -- 4 call sites, all in chat-view, all rendering LLM or enricher
 * output into the DOM.
 *
 * That makes this the highest-risk single piece of the UI shim: the input is
 * adversary-adjacent by construction (an OSINT tool ingests hostile content, and the
 * model relays it). Output is sanitised with DOMPurify. Under sandbox: true plus a
 * CSP of connect-src 'none', a surviving XSS still cannot reach the filesystem, spawn
 * a process, or exfiltrate the vault -- that layering is the actual defence; this is
 * the first layer of it.
 *
 * Wikilinks are rendered as internal links rather than being resolved here: the shell
 * owns link resolution (Phase 5), and duplicating it behind a compat surface would
 * let the two disagree.
 */
import MarkdownIt from 'markdown-it';
import DOMPurify from 'dompurify';
import type { Component } from '../core/component';

const md = new MarkdownIt({
    html: false,        // untrusted input: never pass raw HTML through
    linkify: true,
    breaks: true,
    typographer: false,
});

const WIKILINK = /\[\[([^\]]+)\]\]/g;

/**
 * Wikilinks are converted AFTER rendering and sanitising, by walking text nodes and
 * building real anchor elements.
 *
 * The obvious alternative -- splicing <a> markup into the markdown source -- cannot
 * work: markdown-it runs with html:false (mandatory for untrusted input), so injected
 * tags are escaped into visible text. Doing it on the DOM also means link text can
 * never smuggle markup, because it is only ever set via textContent.
 */
function linkifyWikilinks(root: HTMLElement): void {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    const targets: Text[] = [];
    while (walker.nextNode()) {
        const node = walker.currentNode as Text;
        // Skip text already inside a link or a code block.
        if (node.parentElement?.closest('a, code, pre')) continue;
        if (node.nodeValue && WIKILINK.test(node.nodeValue)) targets.push(node);
        WIKILINK.lastIndex = 0;
    }

    for (const node of targets) {
        const fragment = document.createDocumentFragment();
        const source = node.nodeValue ?? '';
        let cursor = 0;
        for (const match of source.matchAll(WIKILINK)) {
            const at = match.index ?? 0;
            if (at > cursor) fragment.appendChild(document.createTextNode(source.slice(cursor, at)));

            const [target, label] = match[1].split('|');
            const anchor = document.createElement('a');
            anchor.className = 'internal-link';
            anchor.setAttribute('data-href', target.trim());
            anchor.setAttribute('href', '#');
            anchor.textContent = (label ?? target).trim();
            fragment.appendChild(anchor);

            cursor = at + match[0].length;
        }
        if (cursor < source.length) fragment.appendChild(document.createTextNode(source.slice(cursor)));
        node.parentNode?.replaceChild(fragment, node);
    }
}

export const MarkdownRenderer = {
    /**
     * @param component owns the rendered subtree's lifecycle. Obsidian uses it to tear
     * down embedded views; we have none, but the parameter is kept so all four call
     * sites compile unchanged.
     */
    async render(
        _app: unknown | null,
        markdown: string,
        el: HTMLElement,
        _sourcePath: string,
        _component: Component | unknown,
    ): Promise<void> {
        const html = md.render(markdown ?? '');
        el.innerHTML = DOMPurify.sanitize(html, {
            // Block anything that could execute or phone home; the CSP is the backstop,
            // not the only line.
            FORBID_TAGS: ['style', 'script', 'iframe', 'object', 'embed', 'form'],
            FORBID_ATTR: ['style', 'srcset', 'formaction'],
        });
        linkifyWikilinks(el);
    },

    /** Pre-1.0 name; kept because the mock exposed it. */
    async renderMarkdown(
        markdown: string,
        el: HTMLElement,
        sourcePath: string,
        component: Component | unknown,
    ): Promise<void> {
        return MarkdownRenderer.render(null, markdown, el, sourcePath, component);
    },
};
