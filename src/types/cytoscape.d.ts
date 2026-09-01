/**
 * cytoscape@3.28.1 ships no type declarations, and graph-view.ts already hand-declares
 * the exact surface it uses (CytoscapeCore and friends, lines 37-101). Pulling in
 * @types/cytoscape would duplicate and eventually contradict those, so this just makes
 * the bundled import resolvable and lets the local interfaces stay authoritative.
 */
declare module 'cytoscape' {
    const cytoscape: (options?: Record<string, unknown>) => unknown;
    export default cytoscape;
}
