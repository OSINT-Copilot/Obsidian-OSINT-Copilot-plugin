/**
 * setIcon -- Obsidian uses the Lucide icon set, so `lucide-static` gives byte-identical
 * glyphs for the names already in the code (map-pin, pencil, crosshair, chevron-down,
 * file-text, lock, message-square, layout-list, git-fork, calendar).
 */
import * as lucide from 'lucide-static';

const icons = lucide as unknown as Record<string, string>;

/** lucide-static exports PascalCase keys; the codebase uses kebab-case names. */
function toExportName(name: string): string {
    return name.split(/[-_]/).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join('');
}

export function setIcon(el: HTMLElement, iconName: string): void {
    const svg = icons[toExportName(iconName)];
    if (typeof svg === 'string') {
        el.innerHTML = svg;
        el.addClass('svg-icon-wrapper');
        return;
    }
    // Unknown icon: leave a labelled placeholder rather than silently rendering nothing,
    // so a typo'd icon name is visible during development.
    el.textContent = '';
    el.setAttribute('data-missing-icon', iconName);
}

export function getIconIds(): string[] {
    return Object.keys(icons);
}
