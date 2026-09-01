import type { TestApp } from '../../src/obsidian-shim/testing/create-test-app';

/** Every path in the vault, sorted -- the primitive the golden snapshots build on. */
export function snapshotPaths(app: TestApp): string[] {
    return app.storage.paths();
}

export function getContent(app: TestApp, path: string): string | undefined {
    return app.storage.peek(path);
}
