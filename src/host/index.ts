export type * from './types';
/**
 * `host-impl` is resolved per build target:
 *   renderer (esbuild alias) -> ./impl.bridge.ts   forwards to window.host
 *   node / vitest / main     -> ./impl.ts          the real Node implementation
 * Mapped in tsconfig.json paths, esbuild.config.mjs, and vitest.config.ts.
 */
export { host } from 'host-impl';
