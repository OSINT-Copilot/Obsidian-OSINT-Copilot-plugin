/**
 * The ribbon rail: renders the 5 addRibbonIcon registrations the plugin makes.
 *
 * The click event is forwarded because every one of those callbacks inspects it to
 * decide between revealing an existing pane and opening a new tab on Ctrl/Cmd-click.
 */
import { setIcon } from '../../obsidian-shim/ui/set-icon';
import type { Plugin } from '../../obsidian-shim/core/plugin';

export function renderRibbon(plugin: Plugin, mount: HTMLElement): void {
    mount.empty();
    for (const action of plugin.ribbonActions) {
        const button = mount.createDiv({ cls: 'ribbon-item clickable-icon', attr: { 'aria-label': action.title } });
        setIcon(button, action.icon);
        button.addEventListener('click', (event) => { void action.callback(event); });
    }
}
