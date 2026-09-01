import { describe, it, expect } from 'vitest';
import { EntityManager } from '../src/services/entity-manager';
import { createTestApp } from '../src/obsidian-shim/testing/create-test-app';
import { generateId, sanitizeFilename } from '../src/entities/types';

/**
 * INTENDED BEHAVIOURAL CHANGES -- Phase 0 safety net, second half.
 *
 * The port fixes behaviour as well as swapping the host, which costs us the
 * "diff the vault, prove it is byte-identical" oracle. These pairs are the
 * replacement: for each intended change, one test pinning what the code does
 * TODAY, and one `.skip`ped test asserting what it must do AFTER the fix.
 *
 * Rule for the port: every difference between the golden fixtures and the new
 * app must correspond to one of the skipped tests below being un-skipped.
 * Anything else is a regression.
 */

const note = (id: string, type: string, label: string, rels = '') => `---
id: "${id}"
type: ${type}
schemaFamily: ftm
ftmSchema: ${type}
label: "${label}"
name: "${label}"
---

# ${label}

## Relationships
${rels}

## Notes
`;

function vaultWithHandWrittenLink() {
    return createTestApp({
        files: {
            // A plain (unpiped) wikilink, exactly as the note template invites:
            //   "Add relationships using wikilinks: [[Entity Name]] RELATIONSHIP_TYPE [[Target]]"
            'OSINTCopilot/ftm/Company/Lukoil.md': note('id-a', 'Company', 'Lukoil',
                '- [[Lukoil]] DIRECTOR_OF [[Vagit Alekperov]]'),
            'OSINTCopilot/ftm/Person/Vagit Alekperov.md': note('id-b', 'Person', 'Vagit Alekperov'),
        },
    });
}

describe('Change 1 - stop re-parsing wikilinks back into Connection objects', () => {
    /**
     * Note the real defect is narrower than "duplicates on every load": the
     * auto-written links are piped ([[path|Label]]), so findEntityByLabel fails on
     * them and they are silently ignored. It is HAND-WRITTEN plain links that
     * produce phantom connections -- with an unstable id and no disk backing.
     */
    it('TODAY: a hand-written link yields a phantom connection with a NEW id each load', async () => {
        const app = vaultWithHandWrittenLink();

        const loads: string[][] = [];
        for (let i = 0; i < 2; i++) {
            const m = new EntityManager(app as never, 'OSINTCopilot', null);
            await m.loadEntitiesFromNotes();
            loads.push(m.getAllConnections().map((c) => c.id));
        }

        expect(loads[0]).toHaveLength(1);
        expect(loads[1]).toHaveLength(1);
        // Unstable identity: anything keyed on connection id (undo/redo, selection,
        // the graph-yaml mirror) cannot survive a reload.
        expect(loads[0][0]).not.toBe(loads[1][0]);
        // And it never reaches disk, so Connections/ and graph-yaml disagree with memory.
        expect(app.vault.snapshotPaths().some((p) => p.includes('/Connections/'))).toBe(false);
    });

    it.skip('AFTER: connection identity comes only from Connections/ notes, stable across loads', async () => {
        const app = vaultWithHandWrittenLink();

        const loads: string[][] = [];
        for (let i = 0; i < 2; i++) {
            const m = new EntityManager(app as never, 'OSINTCopilot', null);
            await m.loadEntitiesFromNotes();
            loads.push(m.getAllConnections().map((c) => c.id));
        }

        // Wikilinks are rendered and navigable, never parsed back into the model.
        expect(loads[0]).toEqual([]);
        expect(loads[1]).toEqual(loads[0]);
    });
});

describe('Change 3 - sanitizeFilename must not collide on long labels', () => {
    const prefix = 'Lukoil '.repeat(20); // 140 chars: two labels share their first 100
    const a = prefix + 'Netherlands BV';
    const b = prefix + 'Switzerland AG';

    it('TODAY: two distinct labels truncate to the same 100-char filename', () => {
        expect(sanitizeFilename(a)).toHaveLength(100);
        expect(sanitizeFilename(a)).toBe(sanitizeFilename(b));
    });

    it.skip('AFTER: distinct labels always produce distinct filenames', () => {
        expect(sanitizeFilename(a)).not.toBe(sanitizeFilename(b));
    });

    it.skip('AFTER: two long-labelled entities get two separate notes', async () => {
        const app = createTestApp();
        const m = new EntityManager(app as never, 'OSINTCopilot', null);
        await m.initialize();

        const first = await m.createFTMEntity('Company', { name: a }, { skipAutoGeocode: true });
        const second = await m.createFTMEntity('Company', { name: b }, { skipAutoGeocode: true });

        expect(second.filePath).not.toBe(first.filePath);
        expect(m.getAllEntities()).toHaveLength(2);
    });
});

describe('Change 4 - generateId must use crypto.randomUUID', () => {
    it('TODAY: ids are UUIDv4-shaped but derived from Math.random', () => {
        expect(generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

        // Seeding Math.random makes ids fully predictable -- the tell that this is not CSPRNG.
        const original = Math.random;
        try {
            Math.random = () => 0.5;
            expect(generateId()).toBe(generateId());
        } finally {
            Math.random = original;
        }
    });

    it.skip('AFTER: ids are unaffected by Math.random', () => {
        const original = Math.random;
        try {
            Math.random = () => 0.5;
            expect(generateId()).not.toBe(generateId());
        } finally {
            Math.random = original;
        }
    });
});

describe('Change 2 - graph-workspace membership must be explicit', () => {
    it.skip('AFTER: an entity belongs to a workspace independently of graph-positions.json', () => {
        // Today membership is implicit: a node is in workspace X iff it has a key in
        // graph-positions.json[X] (graph-view.ts:2641), so a node that has never been
        // dragged has no membership. Assert the explicit model once it exists.
        expect.fail('pending: explicit workspace membership + migration from position keys');
    });
});

describe('Change 5 - CustomTypesService must support unregister', () => {
    it.skip('AFTER: deleting a custom type removes it without a restart', () => {
        expect.fail('pending: ftmSchemaService.unregisterSchema');
    });
});
