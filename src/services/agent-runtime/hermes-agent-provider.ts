import { execFile } from 'child_process';
import { buildUnifiedAgentSystemPrompt, buildUnifiedAgentUserPrompt } from './build-unified-agent-prompt';
import { parseAgentTurnResult } from './parse-agent-turn-json';
import type { AgentProvider, AgentTurnContext, AgentTurnResult } from './provider-types';
import { splitCliArgsLine } from './cli-args';
import { resolveCliPath, buildCliNotFoundMessage } from '../../utils/resolve-binary-path';
import { sanitizeCliOutput, type ExtractionLogOptions } from '../claude-code-service';

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
        return new Promise((resolve, reject) => {
            let settled = false;
            let onAbort: (() => void) | null = null;
            const rejectOnce = (err: Error): void => {
                if (settled) return;
                settled = true;
                reject(err);
            };

            logOptions?.emit?.({
                phase: 'invoke_start',
                level: 'info',
                message: `Running ${this.cfg.displayName}: ${cliPath}${args.length ? ` (+${args.length} extra arg(s))` : ''}`,
                details: cwd ? `cwd=${cwd}` : 'cwd=(default)',
                timestamp: Date.now(),
            });
            const child = execFile(
                cliPath,
                args,
                {
                    encoding: 'utf8',
                    timeout: this.cfg.timeoutMs || 120_000,
                    maxBuffer: 10 * 1024 * 1024,
                    env: { ...process.env, NO_COLOR: '1' },
                    ...(cwd ? { cwd } : {}),
                },
                (error: Error | null, stdout: string, stderr: string) => {
                    if (signal && onAbort) signal.removeEventListener('abort', onAbort);
                    if (settled) return;
                    settled = true;
                    if (error) {
                        const anyErr = error as { killed?: boolean; signal?: string; code?: string | number | null };
                        if (anyErr.killed || anyErr.signal === 'SIGTERM') {
                            logOptions?.emit?.({
                                phase: 'invoke_aborted',
                                level: 'warn',
                                message: `${this.cfg.displayName} process aborted`,
                                timestamp: Date.now(),
                            });
                            reject(new DOMException('Aborted', 'AbortError'));
                        } else if (anyErr.code === 'ENOENT') {
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
                            reject(new Error(notFoundMessage));
                        } else {
                            const tail = stderr || error.message;
                            logOptions?.emit?.({
                                phase: 'invoke_error',
                                level: 'error',
                                message: `${this.cfg.displayName} failed (code ${anyErr.code ?? '?'})`,
                                details: logOptions?.rawCli ? tail : sanitizeCliOutput(tail, 1200),
                                timestamp: Date.now(),
                            });
                            reject(
                                new Error(
                                    `Hermes CLI error (code ${anyErr.code ?? '?'}): ${tail}`,
                                ),
                            );
                        }
                        return;
                    }
                    logOptions?.emit?.({
                        phase: 'invoke_exit',
                        level: 'info',
                        message: `${this.cfg.displayName} completed successfully`,
                        details: logOptions?.rawCli ? (stdout || '') : sanitizeCliOutput(stdout || '', 400),
                        timestamp: Date.now(),
                    });
                    resolve(stdout || '');
                },
            );

            const stdin = child.stdin;
            if (stdin) {
                // A CLI can reject argv and exit before a large prompt is written. Without an
                // error listener Node treats the resulting EPIPE as an uncaught exception,
                // crashing the Obsidian renderer -- the same fix already applied to
                // ClaudeCodeService.invokeCLI.
                stdin.on('error', (stdinError: NodeJS.ErrnoException) => {
                    if (stdinError.code === 'EPIPE' || settled || child.killed) return;
                    child.kill('SIGTERM');
                    rejectOnce(new Error(`Hermes CLI stdin error: ${stdinError.message}`));
                });
                try {
                    stdin.write(prompt);
                    stdin.end();
                } catch (stdinError) {
                    child.kill('SIGTERM');
                    const message = stdinError instanceof Error ? stdinError.message : String(stdinError);
                    rejectOnce(new Error(`Hermes CLI stdin error: ${message}`));
                }
            }

            if (signal) {
                onAbort = () => {
                    child.kill('SIGTERM');
                };
                signal.addEventListener('abort', onAbort, { once: true });
                if (signal.aborted) onAbort();
            }
        });
    }

    async healthCheck(): Promise<boolean> {
        const args = splitCliArgsLine(this.cfg.healthCheckArgs);
        const cliPath = await resolveCliPath(this.cfg.cliPath, 'hermes');
        const cwd = this.cfg.cliWorkingDirectory?.trim();
        try {
            await new Promise<void>((resolve, reject) => {
                execFile(
                    cliPath,
                    args.length ? args : ['--version'],
                    {
                        encoding: 'utf8',
                        timeout: 8000,
                        maxBuffer: 1024 * 1024,
                        env: { ...process.env, NO_COLOR: '1' },
                        ...(cwd ? { cwd } : {}),
                    },
                    (err) => {
                        if (err) reject(err);
                        else resolve();
                    },
                );
            });
            return true;
        } catch {
            try {
                await new Promise<void>((resolve, reject) => {
                    execFile(
                        cliPath,
                        ['-h'],
                        {
                            encoding: 'utf8',
                            timeout: 8000,
                            maxBuffer: 1024 * 1024,
                            env: { ...process.env, NO_COLOR: '1' },
                            ...(cwd ? { cwd } : {}),
                        },
                        (err) => {
                            if (err) reject(err);
                            else resolve();
                        },
                    );
                });
                return true;
            } catch {
                return false;
            }
        }
    }
}
