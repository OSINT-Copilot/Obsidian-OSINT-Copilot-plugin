import { buildUnifiedAgentSystemPrompt, buildUnifiedAgentUserPrompt } from './build-unified-agent-prompt';
import { parseAgentTurnResult } from './parse-agent-turn-json';
import type { AgentProvider, AgentTurnContext, AgentTurnResult } from './provider-types';
import { splitCliArgsLine } from './cli-args';
import { resolveCliPath, buildCliNotFoundMessage } from '../../utils/resolve-binary-path';
import { sanitizeCliOutput, type ExtractionLogOptions } from '../claude-code-service';
import { host } from '../../host';

export interface HermesAgentRuntimeConfig {
    cliPath: string;
    /** Extra argv tokens after the executable (e.g. "run --json"). Split on whitespace. */
    extraArgs: string;
    timeoutMs: number;
    /** argv tokens for health check (default asks for --version). */
    healthCheckArgs: string;
    /**
     * Exact Settings field label for cliPath, referenced in "not found" error messages. This
     * class backs both the built-in Hermes runtime ("Hermes CLI path") and any custom runtime
     * ("CLI path") -- the two have different field names, so the caller must say which.
     */
    settingLabel: string;
    /**
     * Human-readable name for the runtime this instance backs -- "Hermes Agent" for the built-in
     * runtime, or the user-configured name for a custom runtime. Used anywhere this provider's
     * identity is shown/recorded, since `id` is always the shared literal 'hermes-agent' for both.
     */
    displayName: string;
    /**
     * When set (e.g. Obsidian vault root from `adapter.getBasePath()`), passed as `cwd` to the CLI
     * process, matching `ClaudeCodeConfig.cliWorkingDirectory`.
     */
    cliWorkingDirectory?: string;
}

export class HermesAgentProvider implements AgentProvider {
    private static execSeq = 0;

    readonly id = 'hermes-agent' as const;

    constructor(public readonly cfg: HermesAgentRuntimeConfig) {}

    async runTurn(
        ctx: AgentTurnContext,
        signal: AbortSignal | undefined,
        onProgress?: (message: string, percent: number) => void,
        logOptions?: ExtractionLogOptions,
    ): Promise<AgentTurnResult> {
        onProgress?.('Running Hermes agent (JSON turn)...', 40);
        const system = buildUnifiedAgentSystemPrompt('Hermes Agent');
        const user = buildUnifiedAgentUserPrompt(ctx);
        const fullPrompt = `${system}\n\n---\n\n${user}`;

        const args = splitCliArgsLine(this.cfg.extraArgs);
        const stdout = await this.invokeHermes(fullPrompt, args, signal, logOptions);
        onProgress?.('Parsing agent response...', 85);
        return parseAgentTurnResult(stdout, this.cfg.displayName);
    }

    private async invokeHermes(
        prompt: string,
        args: string[],
        signal: AbortSignal | undefined,
        logOptions?: ExtractionLogOptions,
    ): Promise<string> {
        if (signal?.aborted) {
            logOptions?.emit?.({
                phase: 'invoke_aborted',
                level: 'warn',
                message: 'CLI invocation skipped because request is already aborted',
                timestamp: Date.now(),
            });
            throw new DOMException('Aborted', 'AbortError');
        }
        const cliPath = await resolveCliPath(this.cfg.cliPath, 'hermes');
        // Resolution above can take a few seconds (login shell PATH probe) -- re-check in case
        // the signal fired while we were awaiting it, before the abort listener below existed
        // to catch it.
        if (signal?.aborted) {
            throw new DOMException('Aborted', 'AbortError');
        }
        const cwd = this.cfg.cliWorkingDirectory?.trim();
        logOptions?.emit?.({
            phase: 'invoke_start',
            level: 'info',
            message: `Running ${this.cfg.displayName}: ${cliPath}${args.length ? ` (+${args.length} extra arg(s))` : ''}`,
            details: cwd ? `cwd=${cwd}` : 'cwd=(default)',
            timestamp: Date.now(),
        });

        const execId = `hermes-${Date.now()}-${++HermesAgentProvider.execSeq}`;
        const onAbort = () => host.cli.kill(execId);
        signal?.addEventListener('abort', onAbort, { once: true });

        let result;
        try {
            result = await host.cli.exec(execId, cliPath, args, {
                timeoutMs: this.cfg.timeoutMs || 120_000,
                maxBuffer: 10 * 1024 * 1024,
                envOverrides: { NO_COLOR: '1' },
                ...(cwd ? { cwd } : {}),
                // The host owns the stdin write and its EPIPE guard -- an unhandled
                // EPIPE here used to crash the renderer.
                stdin: prompt,
            });
        } finally {
            signal?.removeEventListener('abort', onAbort);
        }

        if (result.errorMessage !== undefined) {
            if (result.killed || result.signal === 'SIGTERM') {
                logOptions?.emit?.({
                    phase: 'invoke_aborted',
                    level: 'warn',
                    message: `${this.cfg.displayName} process aborted`,
                    timestamp: Date.now(),
                });
                throw new DOMException('Aborted', 'AbortError');
            }
            if (result.code === 'ENOENT') {
                const notFoundMessage = buildCliNotFoundMessage(
                    'Hermes/custom',
                    cliPath,
                    this.cfg.cliPath?.trim() || 'hermes',
                    this.cfg.settingLabel,
                );
                logOptions?.emit?.({
                    phase: 'invoke_error',
                    level: 'error',
                    message: `${this.cfg.displayName} CLI not found`,
                    details: notFoundMessage,
                    timestamp: Date.now(),
                });
                throw new Error(notFoundMessage);
            }
            const tail = result.stderr || result.errorMessage;
            logOptions?.emit?.({
                phase: 'invoke_error',
                level: 'error',
                message: `${this.cfg.displayName} failed (code ${result.code ?? '?'})`,
                details: logOptions?.rawCli ? tail : sanitizeCliOutput(tail, 1200),
                timestamp: Date.now(),
            });
            throw new Error(`Hermes CLI error (code ${result.code ?? '?'}): ${tail}`);
        }

        logOptions?.emit?.({
            phase: 'invoke_exit',
            level: 'info',
            message: `${this.cfg.displayName} completed successfully`,
            details: logOptions?.rawCli ? (result.stdout || '') : sanitizeCliOutput(result.stdout || '', 400),
            timestamp: Date.now(),
        });
        return result.stdout || '';
    }

    async healthCheck(): Promise<boolean> {
        const args = splitCliArgsLine(this.cfg.healthCheckArgs);
        const cliPath = await resolveCliPath(this.cfg.cliPath, 'hermes');
        const cwd = this.cfg.cliWorkingDirectory?.trim();
        const probe = async (probeArgs: string[]): Promise<boolean> => {
            const result = await host.cli.exec(
                `hermes-health-${Date.now()}-${++HermesAgentProvider.execSeq}`,
                cliPath,
                probeArgs,
                {
                    timeoutMs: 8000,
                    maxBuffer: 1024 * 1024,
                    envOverrides: { NO_COLOR: '1' },
                    ...(cwd ? { cwd } : {}),
                },
            );
            return result.errorMessage === undefined;
        };

        // Two-step: the configured health-check args (default --version), then -h for
        // CLIs that have no version flag but do respond to help.
        if (await probe(args.length ? args : ['--version'])) return true;
        return probe(['-h']);
    }
}
