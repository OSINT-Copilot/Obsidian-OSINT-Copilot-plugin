// eslint.config.mjs
import tsparser from "@typescript-eslint/parser";
import tseslint from "typescript-eslint";

/**
 * eslint-plugin-obsidianmd was removed with the `obsidian` package.
 *
 * Its rules enforce Obsidian plugin conventions for a platform this app has left --
 * and one of them (hardcoded-config-path) now fires on the settings-migration code,
 * which references `.obsidian/plugins/...` entirely correctly. The sandbox guardrail
 * below is the rule set that actually matters now.
 */
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
                message: "The renderer is sandboxed and has no `process`. Use `host.platform` / `host.secrets` from src/host.",
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
        plugins: { "@typescript-eslint": tseslint.plugin },
        rules: {
            "@typescript-eslint/no-explicit-any": "warn",
        },
    },
];
