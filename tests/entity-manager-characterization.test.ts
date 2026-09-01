import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EntityManager } from '../src/services/entity-manager';
import { createTestApp, appReady, type TestApp } from '../src/obsidian-shim/testing/create-test-app';
import { getContent, snapshotPaths } from './helpers/vault-inspect';

/**
 * CHARACTERIZATION TESTS -- Phase 0 safety net.
 *
 * These pin the CURRENT on-disk behaviour of EntityManager before the port moves
 * anything. They are not a specification of what is correct; several of the
 * behaviours locked here are known bugs (see the port plan). The point is that any
 * change to the bytes written must be a deliberate, reviewed edit to this file.
 *
 * Determinism: generateId() is a hand-rolled UUIDv4 over Math.random(), so we seed
 * Math.random rather than patching production code.
 */

function seedRandom(seed = 42): () => void {
    let state = seed;
    const spy = vi.spyOn(Math, 'random').mockImplementation(() => {
        // xorshift -- deterministic, uniform enough for UUID nibbles
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        return ((state >>> 0) % 100000) / 100000;
    });
    return () => spy.mockRestore();
}

describe('EntityManager characterization (current behaviour, pre-port)', () => {
    let app: TestApp;
    let manager: EntityManager;
    let restoreRandom: () => void;

    beforeEach(async () => {
        restoreRandom = seedRandom();
        app = createTestApp();
        manager = new EntityManager(app as never, 'OSINTCopilot', null);
        await manager.initialize();
    });

    afterEach(() => restoreRandom());

    it('initialize() creates the vault folder skeleton', () => {
        expect(snapshotPaths(app)).toMatchSnapshot();
    });

    it('createFTMEntity writes a note and returns a populated entity', async () => {
        const entity = await manager.createFTMEntity(
            'Company',
            { name: 'Lukoil', country: 'ru' },
            { skipAutoGeocode: true },
        );

        expect(entity.label).toBe('Lukoil');
        expect(entity.filePath).toBeTruthy();
        expect(getContent(app, entity.filePath!)).toMatchSnapshot('lukoil-note');
    });

    it('mirrors every entity into graph-yaml', async () => {
        await manager.createFTMEntity('Company', { name: 'Lukoil' }, { skipAutoGeocode: true });
        const yamlPaths = snapshotPaths(app).filter((p) => p.includes('graph-yaml'));
        expect(yamlPaths.length).toBeGreaterThan(0);
        expect(getContent(app, yamlPaths.find((p) => p.endsWith('.yaml'))!)).toMatchSnapshot('lukoil-yaml');
    });

    it('createConnection writes a connection note and appends to both endpoints', async () => {
        const from = await manager.createFTMEntity('Company', { name: 'Lukoil' }, { skipAutoGeocode: true });
        const to = await manager.createFTMEntity('Person', { name: 'Vagit Alekperov' }, { skipAutoGeocode: true });

        const conn = await manager.createConnection(from.id, to.id, 'DIRECTOR_OF');
        expect(conn).not.toBeNull();

        expect(getContent(app, conn!.filePath!)).toMatchSnapshot('connection-note');
        expect(getContent(app, from.filePath!)).toContain('DIRECTOR_OF');
        expect(getContent(app, to.filePath!)).toContain('DIRECTOR_OF');
    });

    it('updateEntity rewrites the same note rather than creating a second one', async () => {
        const entity = await manager.createFTMEntity('Company', { name: 'Lukoil' }, { skipAutoGeocode: true });
        const before = snapshotPaths(app).length;

        await manager.updateEntity(entity.id, { name: 'Lukoil', country: 'ru' });

        expect(snapshotPaths(app).length).toBe(before);
        expect(getContent(app, entity.filePath!)).toContain('ru');
    });

    it('deleteEntity removes the note and its graph-yaml mirror', async () => {
        const entity = await manager.createFTMEntity('Company', { name: 'Lukoil' }, { skipAutoGeocode: true });
        expect(app.vault.getAbstractFileByPath(entity.filePath!)).not.toBeNull();

        await manager.deleteEntity(entity.id);

        expect(app.vault.getAbstractFileByPath(entity.filePath!)).toBeNull();
        expect(snapshotPaths(app).filter((p) => p.endsWith('.yaml'))).toEqual([]);
    });

    it('round-trips a full vault through loadEntitiesFromNotes', async () => {
        const from = await manager.createFTMEntity('Company', { name: 'Lukoil' }, { skipAutoGeocode: true });
        const to = await manager.createFTMEntity('Person', { name: 'Vagit Alekperov' }, { skipAutoGeocode: true });
        await manager.createConnection(from.id, to.id, 'DIRECTOR_OF');

        const pathsBefore = snapshotPaths(app);

        const reloaded = new EntityManager(app as never, 'OSINTCopilot', null);
        await reloaded.loadEntitiesFromNotes();

        expect(reloaded.getAllEntities().map((e) => e.label).sort())
            .toEqual(['Lukoil', 'Vagit Alekperov']);
        // Reloading must not mutate the vault.
        expect(snapshotPaths(app)).toEqual(pathsBefore);
    });
});
