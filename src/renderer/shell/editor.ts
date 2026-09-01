/**
 * CodeMirror 6 markdown editor.
 *
 * Note the CM packages were already listed as esbuild externals in the plugin build
 * because Obsidian provided them; standalone, they are simply real dependencies.
 *
 * Autosave is debounced and also flushed on blur and on teardown, so closing a tab or
 * quitting cannot lose the last keystrokes.
 */
import { EditorState, type Extension } from '@codemirror/state';
import { EditorView, keymap, highlightActiveLine, lineNumbers } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { syntaxHighlighting, HighlightStyle, foldGutter, bracketMatching } from '@codemirror/language';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { tags } from '@lezer/highlight';

/** Colours come from the theme tokens, so the editor follows light/dark with everything else. */
const highlightStyle = HighlightStyle.define([
    { tag: tags.heading, color: 'var(--text-normal)', fontWeight: '600' },
    { tag: tags.strong, fontWeight: '600' },
    { tag: tags.emphasis, fontStyle: 'italic' },
    { tag: tags.link, color: 'var(--link-color)' },
    { tag: tags.url, color: 'var(--text-muted)' },
    { tag: tags.monospace, color: 'var(--text-accent)' },
    { tag: tags.quote, color: 'var(--text-muted)' },
    { tag: tags.meta, color: 'var(--text-muted)' },
]);

const theme = EditorView.theme({
    '&': { height: '100%', backgroundColor: 'var(--background-primary)', color: 'var(--text-normal)' },
    '.cm-scroller': { fontFamily: 'var(--font-monospace)', lineHeight: '1.6', overflow: 'auto' },
    '.cm-content': { padding: '16px 0' },
    '.cm-gutters': {
        backgroundColor: 'var(--background-primary)',
        color: 'var(--text-muted)',
        border: 'none',
    },
    '.cm-activeLine': { backgroundColor: 'var(--background-modifier-hover)' },
    '&.cm-focused': { outline: 'none' },
}, { dark: true });

export interface EditorOptions {
    initialText: string;
    onChange(text: string): void;
    /** Basenames offered for [[wikilink]] completion. */
    linkTargets(): string[];
}

/** `[[` opens completion over existing note names. */
function wikilinkCompletion(targets: () => string[]) {
    return (context: CompletionContext): CompletionResult | null => {
        const before = context.matchBefore(/\[\[[^\]]*/);
        if (!before || (before.from === before.to && !context.explicit)) return null;
        return {
            from: before.from + 2,
            options: targets().map((label) => ({ label, type: 'text' })),
        };
    };
}

export class MarkdownEditor {
    private readonly view: EditorView;
    private saveTimer: number | null = null;

    constructor(parent: HTMLElement, private readonly options: EditorOptions) {
        const extensions: Extension[] = [
            lineNumbers(),
            foldGutter(),
            history(),
            bracketMatching(),
            highlightActiveLine(),
            highlightSelectionMatches(),
            markdown(),
            syntaxHighlighting(highlightStyle),
            autocompletion({ override: [wikilinkCompletion(options.linkTargets)] }),
            keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
            EditorView.lineWrapping,
            theme,
            EditorView.updateListener.of((update) => {
                if (update.docChanged) this.scheduleSave();
            }),
            EditorView.domEventHandlers({ blur: () => { this.flush(); return false; } }),
        ];

        this.view = new EditorView({
            state: EditorState.create({ doc: options.initialText, extensions }),
            parent,
        });
    }

    getValue(): string {
        return this.view.state.doc.toString();
    }

    focus(): void {
        this.view.focus();
    }

    private scheduleSave(): void {
        if (this.saveTimer !== null) window.clearTimeout(this.saveTimer);
        this.saveTimer = window.setTimeout(() => this.flush(), 600);
    }

    flush(): void {
        if (this.saveTimer !== null) {
            window.clearTimeout(this.saveTimer);
            this.saveTimer = null;
        }
        this.options.onChange(this.getValue());
    }

    destroy(): void {
        this.flush();
        this.view.destroy();
    }
}
