import { describe, it, expect, vi, beforeEach } from 'vitest';
import { App, TFile } from 'obsidian';
import { EntityManager } from '../src/services/entity-manager';
import { EntityType } from '../src/entities/types';

describe('EntityManager frontmatter reserved-key handling', () => {
  let app: App;
  let manager: EntityManager;

  beforeEach(() => {
    app = new App();
    manager = new EntityManager(app as any, 'OSINTCopilot', null);
  });

  it('writes reserved property keys under props namespace', () => {
    const fm = (manager as any).buildFTMFrontmatter(
      {
        id: 'e1',
        type: 'Address',
        label: 'Address',
        properties: {
          type: 'residence',
          city: 'Prato',
        },
      },
      'Address',
    ) as string;

    expect(fm).toContain('type: Address');
    expect(fm).toContain('city: "Prato"');
    expect(fm).toContain('props:');
    expect(fm).toContain('  type: residence');
    expect(/^type:\s*"residence"$/m.test(fm)).toBe(false);
  });

  it('parses frontmatter props block and preserves entity type', async () => {
    const file = new TFile() as any;
    file.path = 'OSINTCopilot/ftm/Address/Address.md';

    const content = `---
id: "e2"
type: Address
schemaFamily: ftm
ftmSchema: Address
label: "Address"
city: "LegacyCity"
props:
  type: "residence"
  city: "Prato"
---

# Address
`;
    (app.vault.read as any) = vi.fn().mockResolvedValue(content);

    const entity = await (manager as any).parseEntityFromNote(file, 'ftm');
    expect(entity).toBeTruthy();
    expect(entity.type).toBe('Address');
    expect(entity.properties.type).toBe('residence');
    expect(entity.properties.city).toBe('Prato');
  });

  it('still parses legacy notes without props block', async () => {
    const file = new TFile() as any;
    file.path = 'OSINTCopilot/ftm/Document/Doc.md';

    const content = `---
id: "e3"
type: Document
schemaFamily: ftm
ftmSchema: Document
label: "Document"
document_kind: "EHIC"
---

# Document
`;
    (app.vault.read as any) = vi.fn().mockResolvedValue(content);

    const entity = await (manager as any).parseEntityFromNote(file, 'ftm');
    expect(entity).toBeTruthy();
    expect(entity.type).toBe('Document');
    expect(entity.properties.document_kind).toBe('EHIC');
  });
});

describe('EntityManager legacy-to-FTM schema wiring (createEntity -> updateEntity path consistency)', () => {
  let app: App;
  let manager: EntityManager;
  // Simple in-memory path -> TFile registry so getAbstractFileByPath reflects what create() wrote,
  // the same way a real vault would -- this is what makes the regression below observable: the
  // original bug had createEntity() and updateEntity() compute two DIFFERENT paths for the same
  // entity, so updateEntity's getAbstractFileByPath(itsOwnPath) would never find create()'s file.
  let files: Map<string, TFile>;

  beforeEach(() => {
    app = new App();
    files = new Map();
    app.vault.getAbstractFileByPath = vi.fn((path: string) => files.get(path) ?? null);
    app.vault.createFolder = vi.fn().mockResolvedValue(undefined);
    app.vault.create = vi.fn(async (path: string) => {
      const file = new TFile();
      (file as any).path = path;
      files.set(path, file);
      return file;
    });
    app.vault.modify = vi.fn().mockResolvedValue(undefined);
    manager = new EntityManager(app as any, 'OSINTCopilot', null);
  });

  // createEntity() also triggers an unrelated, pre-existing parallel export (one .yaml file per
  // entity under graph-yaml/) -- filter to the .md note path specifically so that legitimate,
  // unrelated write isn't mistaken for a second copy of the note itself.
  const mdCreateCalls = (mockFn: typeof app.vault.create) =>
    vi.mocked(mockFn).mock.calls.filter(([path]) => typeof path === 'string' && path.endsWith('.md'));

  it('creating a legacy Location entity saves it via the FTM path (not the ID-suffixed legacy filename)', async () => {
    const entity = await manager.createEntity(
      EntityType.Location,
      { address: '123 Main St' },
      { skipAutoGeocode: true },
    );

    expect(entity.ftmSchema).toBe('Address');
    // The legacy save path names files "<label>_<id8>.md" under "<base>/<type>/" -- if createEntity
    // used that instead of the FTM save path, this would fail.
    expect(entity.filePath).not.toMatch(new RegExp(`_${entity.id.substring(0, 8)}\\.md$`));
    expect(mdCreateCalls(app.vault.create)).toHaveLength(1);
  });

  it('editing a legacy-created Location entity modifies its own note instead of creating a duplicate', async () => {
    const entity = await manager.createEntity(
      EntityType.Location,
      { address: '123 Main St' },
      { skipAutoGeocode: true },
    );
    vi.mocked(app.vault.create).mockClear();

    const updated = await manager.updateEntity(entity.id, { address: '123 Main St', notes: 'verified' });

    expect(updated).toBeTruthy();
    // The regression: updateEntity() computed a different path than createEntity() used, so it
    // never found the existing file and called create() again instead of modify().
    const mdModifyCalls = vi.mocked(app.vault.modify).mock.calls.filter(([file]) => (file as TFile).path?.endsWith('.md'));
    expect(mdModifyCalls).toHaveLength(1);
    expect(mdCreateCalls(app.vault.create)).toHaveLength(0);
    expect(Array.from(files.keys()).filter((p) => p.endsWith('.md'))).toHaveLength(1);
  });

  it('does not duplicate the note on first edit even when multiple candidate label fields are filled in', async () => {
    // Location's legacy labelField is "address", but "name" is also a fillable property on the
    // form -- and the FTM Address schema's own label fallback chain checks "name" before
    // "address". If create() and update() ever compute the label via different functions/priority
    // orders, a Location with both fields filled would get a different label (and thus filename)
    // on its very first edit even though nothing the user typed changed.
    const entity = await manager.createEntity(
      EntityType.Location,
      { name: 'Empire State Building', address: '350 5th Ave' },
      { skipAutoGeocode: true },
    );
    vi.mocked(app.vault.create).mockClear();

    const updated = await manager.updateEntity(entity.id, {
      name: 'Empire State Building',
      address: '350 5th Ave',
      notes: 'verified',
    });

    expect(updated?.label).toBe(entity.label);
    const mdModifyCalls = vi.mocked(app.vault.modify).mock.calls.filter(([file]) => (file as TFile).path?.endsWith('.md'));
    expect(mdModifyCalls).toHaveLength(1);
    expect(mdCreateCalls(app.vault.create)).toHaveLength(0);
    expect(Array.from(files.keys()).filter((p) => p.endsWith('.md'))).toHaveLength(1);
  });

  it.each([
    { type: EntityType.Phone, properties: { number: '+1 555 123 4567' }, expectedLabel: '+1 555 123 4567' },
    { type: EntityType.Text, properties: { text: 'A short note captured from OSINT research' }, expectedLabel: 'A short note captured from OSINT research' },
  ])(
    'uses the real $type value as the label, not the mapped FTM schema name ($type -> generic fallback regression)',
    async ({ type, properties, expectedLabel }) => {
      // Phone's legacy labelField is "number" and Text's is "text" -- neither is one of
      // ftmSchemaService.getEntityLabel()'s generic fallback fields, so its mapped FTM schema
      // (LegalEntity / Document) can't find a real label and falls back to returning the bare
      // schema name itself. That must not leak into the entity's actual label.
      const entity = await manager.createEntity(type, properties, { skipAutoGeocode: true });

      expect(entity.label).toBe(expectedLabel);
      expect(entity.label).not.toBe(entity.ftmSchema);
    },
  );
});
