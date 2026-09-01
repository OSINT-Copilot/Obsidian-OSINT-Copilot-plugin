// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

// Extract rules from recommended config (assuming it's a rule object or contains them)
const recommendedRules = obsidianmd.configs.recommended.rules || obsidianmd.configs.recommended;

// Filter out non-rule keys just in case (like 'plugins' or 'extends' if they exist at top level)
const rules = {};
for (const [key, value] of Object.entries(recommendedRules)) {
    if (key.includes('/')) { // Simple heuristic: plugin rules usually contain '/'
        rules[key] = value;
    }
}

export default [
    /**
     * Sandbox guardrail.
     *
     * Under sandbox: true the renderer has no `process` and no `require`. The set of
     * files that legitimately touch Node is exactly src/host/** (the Node host impl)
     * and electron/** (main + preload). Without this rule that stays true for about a
     * month: every new CLI or filesystem feature is one `require('fs')` away from
     * silently breaking the security posture, and the failure mode is a runtime crash
     * in a packaged build rather than a build error.
     */
    {
        files: ["src/**/*.ts"],
        ignores: ["src/host/**"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { project: "./tsconfig.json" },
        },
        rules: {
            "no-restricted-globals": ["error", {
                name: "process",
                message: "The renderer is sandboxed and has no `process`. Use `host.platform` / `host.env.get()` from src/host.",
            }],
            "no-restricted-imports": ["error", {
                paths: [
                    { name: "fs", message: "Renderer has no fs. Go through src/host." },
                    { name: "node:fs", message: "Renderer has no fs. Go through src/host." },
                    { name: "child_process", message: "Renderer cannot spawn. Use host.cli.exec()." },
                    { name: "node:child_process", message: "Renderer cannot spawn. Use host.cli.exec()." },
                    { name: "os", message: "Use host.platform (os, arch, homedir)." },
                    { name: "node:os", message: "Use host.platform (os, arch, homedir)." },
                    { name: "zlib", message: "Node-only. Belongs in src/host/node/." },
                    { name: "node:zlib", message: "Node-only. Belongs in src/host/node/." },
                    { name: "path", message: "Use the pure helpers in src/host/paths.ts." },
                    { name: "node:path", message: "Use the pure helpers in src/host/paths.ts." },
                ],
            }],
        },
    },
    {
        files: ["**/*.ts"],
        languageOptions: {
            parser: tsparser,
            parserOptions: { project: "./tsconfig.json" },
        },
        plugins: {
            "obsidianmd": obsidianmd,
            "@typescript-eslint": tseslint.plugin
        },
        rules: {
            ...rules,
            // User requested overrides
            "obsidianmd/sample-names": "off",
            "obsidianmd/prefer-file-manager-trash-file": "error",
            "@typescript-eslint/no-explicit-any": "warn",
            "obsidianmd/ui/sentence-case": ["error", { "allowAutoFix": true }],
            "obsidianmd/no-static-styles-assignment": "warn"
        }
    }
];
