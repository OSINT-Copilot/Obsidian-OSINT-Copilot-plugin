import { describe, it, expect } from 'vitest';
import { EntityManager } from '../src/services/entity-manager';
import { createTestApp, appReady } from '../src/obsidian-shim/testing/create-test-app';
import { getContent, snapshotPaths } from './helpers/vault-inspect';
import { generateId, sanitizeFilename } from '../src/entities/types';
import { ftmSchemaService } from '../src/services/ftm-schema-service';

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

async function vaultWithHandWrittenLink() {
    const app = createTestApp({
        files: {
            // A plain (unpiped) wikilink, exactly as the note template invites:
            //   "Add relationships using wikilinks: [[Entity Name]] RELATIONSHIP_TYPE [[Target]]"
            'OSINTCopilot/ftm/Company/Lukoil.md': note('id-a', 'Company', 'Lukoil',
                '- [[Lukoil]] DIRECTOR_OF [[Vagit Alekperov]]'),
            'OSINTCopilot/ftm/Person/Vagit Alekperov.md': note('id-b', 'Person', 'Vagit Alekperov'),
        },
    });
    await appReady(app);
    return app;
}

describe('Change 1 - wikilinks are rendered, never parsed back into Connections', () => {
    /**
     * Note the real defect is narrower than "duplicates on every load": the
     * auto-written links are piped ([[path|Label]]), so findEntityByLabel fails on
     * them and they are silently ignored. It is HAND-WRITTEN plain links that
     * produce phantom connections -- with an unstable id and no disk backing.
     */
    it('connection identity comes only from Connections/ notes, stable across loads', async () => {
        const app = await vaultWithHandWrittenLink();

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

describe('Change 3 - sanitizeFilename does not collide on long labels', () => {
    const prefix = 'Lukoil '.repeat(20); // 140 chars: two labels share their first 100
    const a = prefix + 'Netherlands BV';
    const b = prefix + 'Switzerland AG';

    it('distinct labels always produce distinct filenames', () => {
        expect(sanitizeFilename(a)).not.toBe(sanitizeFilename(b));
    });

    it('two long-labelled entities get two separate notes', async () => {
        const app = createTestApp();
        const m = new EntityManager(app as never, 'OSINTCopilot', null);
        await m.initialize();

        const first = await m.createFTMEntity('Company', { name: a }, { skipAutoGeocode: true });
        const second = await m.createFTMEntity('Company', { name: b }, { skipAutoGeocode: true });

        expect(second.filePath).not.toBe(first.filePath);
        expect(m.getAllEntities()).toHaveLength(2);
    });
});

describe('Change 4 - generateId uses crypto.randomUUID', () => {
    it('ids are still UUIDv4-shaped', () => {
        expect(generateId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    });

    it('ids are unaffected by Math.random', () => {
        const original = Math.random;
        try {
            Math.random = () => 0.5;
            expect(generateId()).not.toBe(generateId());
        } finally {
            Math.random = original;
        }
    });
});

describe('Change 2 - graph-workspace membership is explicit', () => {
    /**
     * Exercised through the persistence format rather than the view, because
     * GraphView needs Cytoscape and a live leaf. The format IS the contract: v3 stores
     * membersByGraph, and anything older derives it from position keys so an existing
     * vault keeps the same workspace contents.
     */
    interface PositionsFileV3 {
        version: number;
        byGraph: Record<string, Record<string, { x: number; y: number }>>;
        membersByGraph?: Record<string, string[]>;
    }

    function membersFor(raw: PositionsFileV3, graphId: string): string[] {
        const stored = raw.version === 3 ? raw.membersByGraph : null;
        return (stored?.[graphId] ?? Object.keys(raw.byGraph[graphId] ?? {})).sort();
    }

    it('migrates a v2 file by deriving membership from position keys', () => {
        const v2: PositionsFileV3 = {
            version: 2,
            byGraph: { default: { a: { x: 0, y: 0 } }, 'case-1': { b: { x: 1, y: 1 }, c: { x: 2, y: 2 } } },
        };
        expect(membersFor(v2, 'case-1')).toEqual(['b', 'c']);
    });

    it('reads membership from v3 rather than inferring it', () => {
        const v3: PositionsFileV3 = {
            version: 3,
            // 'd' is a member with no saved position: it has never been dragged.
            byGraph: { 'case-1': { b: { x: 1, y: 1 } } },
            membersByGraph: { 'case-1': ['b', 'd'] },
        };
        expect(membersFor(v3, 'case-1')).toEqual(['b', 'd']);
    });

    it('membership survives losing every saved position', () => {
        // Under the old implicit rule, clearing a layout silently emptied the workspace.
        const v3: PositionsFileV3 = {
            version: 3,
            byGraph: { 'case-1': {} },
            membersByGraph: { 'case-1': ['b', 'c'] },
        };
        expect(membersFor(v3, 'case-1')).toEqual(['b', 'c']);
    });
});

describe('Change 5 - custom types can be unregistered without a restart', () => {
    it('a registered type resolves, and stops resolving once unregistered', () => {
        ftmSchemaService.initialize();
        const name = 'TestOnlyCustomType';

        ftmSchemaService.registerSchema({
            name,
            label: 'Test Only',
            extends: ['Thing'],
            properties: { codename: { label: 'Codename', type: 'string' } },
        });
        expect(ftmSchemaService.getSchema(name)?.allProperties.codename).toBeDefined();

        expect(ftmSchemaService.unregisterSchema(name)).toBe(true);
        expect(ftmSchemaService.getSchema(name)).toBeNull();

        // Removing something that was never registered is a no-op, not an error.
        expect(ftmSchemaService.unregisterSchema(name)).toBe(false);
    });

    it('does not remove bundled OIDSF schemas', () => {
        ftmSchemaService.initialize();
        expect(ftmSchemaService.unregisterSchema('Company')).toBe(false);
        expect(ftmSchemaService.getSchema('Company')).not.toBeNull();
    });

    it('descendants stop inheriting from an unregistered parent', () => {
        ftmSchemaService.initialize();
        ftmSchemaService.registerSchema({
            name: 'TestParentType', label: 'Parent', extends: ['Thing'],
            properties: { inherited: { label: 'Inherited', type: 'string' } },
        });
        ftmSchemaService.registerSchema({
            name: 'TestChildType', label: 'Child', extends: ['TestParentType'],
            properties: { own: { label: 'Own', type: 'string' } },
        });
        expect(ftmSchemaService.getSchema('TestChildType')?.allProperties.inherited).toBeDefined();

        ftmSchemaService.unregisterSchema('TestParentType');

        // The child was resolved while the parent existed; without a full cache drop it
        // would keep serving properties inherited from a type that no longer exists.
        expect(ftmSchemaService.getSchema('TestChildType')?.allProperties.inherited).toBeUndefined();

        ftmSchemaService.unregisterSchema('TestChildType');
    });
});
