import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphHistoryManager, type HistoryCallbacks } from '../src/services/graph-history-manager';
import type { Entity, Connection } from '../src/entities/types';

/**
 * CHARACTERIZATION -- Phase 0 safety net.
 *
 * graph-history-manager is pure (no Obsidian, no fs) and had zero tests despite
 * driving every undo/redo path in the graph view. It ports unchanged, which makes
 * these tests a cheap, permanent guard rather than throwaway scaffolding.
 */

const entity = (id: string, label = id): Entity =>
    ({ id, type: 'Company', label, properties: {} }) as Entity;

const connection = (id: string, from = 'a', to = 'b'): Connection =>
    ({ id, fromEntityId: from, toEntityId: to, relationship: 'OWNS' }) as Connection;

function spyCallbacks(): HistoryCallbacks & { calls: string[] } {
    const calls: string[] = [];
    const record = (name: string) => vi.fn(async (arg: unknown) => {
        calls.push(`${name}:${typeof arg === 'string' ? arg : (arg as { id?: string })?.id}`);
    });
    return {
        calls,
        onEntityCreate: record('entityCreate'),
        onEntityDelete: record('entityDelete'),
        onEntityRestore: record('entityRestore'),
        onEntityUpdate: record('entityUpdate'),
        onConnectionCreate: record('connCreate'),
        onConnectionDelete: record('connDelete'),
        onConnectionRestore: record('connRestore'),
        onConnectionUpdate: record('connUpdate'),
        onNodePositionChange: vi.fn(() => { calls.push('positions'); }),
    } as HistoryCallbacks & { calls: string[] };
}

describe('GraphHistoryManager characterization', () => {
    let history: GraphHistoryManager;
    let callbacks: ReturnType<typeof spyCallbacks>;

    beforeEach(() => {
        history = new GraphHistoryManager();
        callbacks = spyCallbacks();
        history.setCallbacks(callbacks);
    });

    it('starts empty and refuses undo/redo', () => {
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);
        expect(history.getTotalHistorySize()).toBe(0);
    });

    it('undo of a create deletes, and redo re-creates', async () => {
        history.recordEntityCreate(entity('e1'));
        expect(history.canUndo()).toBe(true);

        expect(await history.undo()).toBe(true);
        expect(callbacks.calls).toContain('entityDelete:e1');
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(true);

        expect(await history.redo()).toBe(true);
        expect(callbacks.calls).toContain('entityRestore:e1');
        expect(history.canRedo()).toBe(false);
    });

    it('undo of a delete restores the entity', async () => {
        history.recordEntityDelete(entity('e2'));
        await history.undo();
        expect(callbacks.calls).toContain('entityRestore:e2');
    });

    it('undo of an edit reverts to the previous entity', async () => {
        history.recordEntityEdit(entity('e3', 'before'), entity('e3', 'after'));
        await history.undo();
        expect(callbacks.onEntityUpdate).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'e3', label: 'before' }),
        );
    });

    it('handles connection create/delete symmetrically', async () => {
        history.recordRelationshipCreate(connection('c1'));
        await history.undo();
        expect(callbacks.calls).toContain('connDelete:c1');
        await history.redo();
        expect(callbacks.calls).toContain('connRestore:c1');
    });

    it('a new action after undo clears the redo stack', async () => {
        history.recordEntityCreate(entity('e1'));
        await history.undo();
        expect(history.canRedo()).toBe(true);

        history.recordEntityCreate(entity('e2'));
        expect(history.canRedo()).toBe(false);
    });

    it('caps the stack at maxHistorySize, discarding oldest first', () => {
        const capped = new GraphHistoryManager(3);
        capped.setCallbacks(callbacks);
        for (let i = 0; i < 10; i++) capped.recordEntityCreate(entity(`e${i}`));
        expect(capped.getTotalHistorySize()).toBe(3);
        expect(capped.getUndoStack().map((e) => e.id)).toHaveLength(3);
    });

    it('notifies listeners on record and stops after removeListener', () => {
        const listener = vi.fn();
        history.addListener(listener);
        history.recordEntityCreate(entity('e1'));
        const afterAdd = listener.mock.calls.length;
        expect(afterAdd).toBeGreaterThan(0);

        history.removeListener(listener);
        history.recordEntityCreate(entity('e2'));
        expect(listener.mock.calls.length).toBe(afterAdd);
    });

    it('clear() empties both stacks', async () => {
        history.recordEntityCreate(entity('e1'));
        await history.undo();
        history.clear();
        expect(history.canUndo()).toBe(false);
        expect(history.canRedo()).toBe(false);
        expect(history.getTotalHistorySize()).toBe(0);
    });

    it('node position changes round-trip through the position callback', async () => {
        const before = new Map([['e1', { x: 0, y: 0 }]]);
        const after = new Map([['e1', { x: 50, y: 50 }]]);
        history.recordNodePositionChange(before, after);

        await history.undo();
        expect(callbacks.onNodePositionChange).toHaveBeenLastCalledWith(before);
        await history.redo();
        expect(callbacks.onNodePositionChange).toHaveBeenLastCalledWith(after);
    });
});
