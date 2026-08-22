import { spawn } from 'node:child_process';
import type {
  ModelDefinition,
  PhoenixRequest,
  PhoenixResponse,
  ProviderAdapter,
  ProviderDefinition,
} from '@phoenix/contracts';
import { ProviderTransportError } from './index.js';

const bridgeCapabilities = {
  input: ['text'] as const,
  output: ['text'] as const,
  tools: false,
  json: false,
  reasoning: true,
  streaming: false,
};

function subscriptionModels(ids: readonly string[], quotaBucket: string): ModelDefinition[] {
  return ids.map((id) => ({
    id,
    displayName: id === 'default' ? 'Plan default' : id,
    capabilities: bridgeCapabilities,
    economics: { billingMode: 'subscription', quotaBucket },
    tags: ['subscription', 'external-agent', 'read-only-bridge'],
  }));
}

export function codexSubscriptionProvider(models: readonly string[] = ['default']): ProviderDefinition {
  return {
    id: 'codex-cli',
    displayName: 'Codex CLI (ChatGPT plan)',
    baseUrl: 'local-cli://codex',
    protocol: 'subscription-cli',
    models: subscriptionModels(models, 'chatgpt-codex'),
    tags: ['subscription', 'codex', 'chatgpt-login', 'cloud-inference'],
  };
}

export function claudeCodeSubscriptionProvider(models: readonly string[] = ['default']): ProviderDefinition {
  return {
    id: 'claude-code-cli',
    displayName: 'Claude Code CLI (Claude plan)',
    baseUrl: 'local-cli://claude',
    protocol: 'subscription-cli',
    models: subscriptionModels(models, 'claude-code'),
    tags: ['subscription', 'claude-code', 'cloud-inference'],
  };
}

interface CliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface CliRunOptions {
  binary: string;
  args: readonly string[];
  input: string;
  cwd?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function looksRetryable(text: string): boolean {
  return /429|rate.?limit|temporar|timeout|timed out|overloaded|503|502|500/i.test(text);
}

async function runCli(options: CliRunOptions): Promise<CliResult> {
  return await new Promise<CliResult>((resolve, reject) => {
    const child = spawn(options.binary, options.args, {
      ...(options.cwd ? { cwd: options.cwd } : {}),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      child.kill();
    }, Math.max(1_000, options.timeoutMs ?? 10 * 60_000));

    const abort = () => child.kill();
    options.signal?.addEventListener('abort', abort, { once: true });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => { stdout += chunk; });
    child.stderr.on('data', (chunk: string) => { stderr += chunk; });
    child.on('error', (error: NodeJS.ErrnoException) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      const missing = error.code === 'ENOENT';
      reject(new ProviderTransportError(
        missing ? `${options.binary} CLI is not installed or not on PATH` : error.message,
        undefined,
        false,
      ));
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      options.signal?.removeEventListener('abort', abort);
      resolve({ stdout, stderr, exitCode: code ?? -1 });
    });
    child.stdin.on('error', () => undefined);
    child.stdin.end(options.input);
  });
}

function renderBridgePrompt(request: PhoenixRequest): string {
  const lines = [
    'You are a read-only reasoning lane inside PHOENIX.',
    'Do not modify the workspace, deploy, commit, send messages, or perform irreversible actions.',
    'Answer the supplied conversation as the assistant. PHOENIX retains execution authority.',
    '',
  ];
  for (const message of request.messages) {
    const role = message.role.toUpperCase();
    lines.push(`${role}: ${message.content}`);
    if (message.toolCalls?.length) {
      lines.push(`ASSISTANT_TOOL_CALLS: ${JSON.stringify(message.toolCalls)}`);
    }
    if (message.toolCallId) lines.push(`TOOL_CALL_ID: ${message.toolCallId}`);
  }
  if (request.requirements?.json) lines.push('\nReturn valid JSON only.');
  return lines.join('\n');
}

function workingDirectory(request: PhoenixRequest): string | undefined {
  const value = request.metadata?.workingDirectory;
  return value?.trim() ? value : undefined;
}

function sessionId(request: PhoenixRequest): string | undefined {
  const value = request.metadata?.providerSessionId;
  return value?.trim() ? value : undefined;
}

function modelArgs(model: ModelDefinition): string[] {
  return model.id === 'default' ? [] : ['--model', model.id];
}

interface CodexUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  cache_write_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
}

export class CodexCliAdapter implements ProviderAdapter {
  public readonly providerId = 'codex-cli';

  public constructor(private readonly binary = 'codex') {}

  public async generate(
    provider: ProviderDefinition,
    model: ModelDefinition,
    request: PhoenixRequest,
    context?: { signal?: AbortSignal },
  ): Promise<PhoenixResponse> {
    const resume = sessionId(request);
    const args = [
      'exec',
      '--json',
      '--sandbox',
      'read-only',
      '--skip-git-repo-check',
      ...modelArgs(model),
      ...(resume ? ['resume', resume, '-'] : ['-']),
    ];
    const result = await runCli({
      binary: this.binary,
      args,
      input: renderBridgePrompt(request),
      ...(workingDirectory(request) ? { cwd: workingDirectory(request) } : {}),
      ...(context?.signal ? { signal: context.signal } : {}),
    });
    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).slice(-4_000);
      throw new ProviderTransportError(
        `Codex CLI failed with exit ${result.exitCode}: ${detail}`,
        undefined,
        looksRetryable(detail),
      );
    }

    let finalResponse = '';
    let threadId: string | undefined = resume;
    let usage: CodexUsage | undefined;
    for (const raw of result.stdout.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      let event: Record<string, unknown>;
      try {
        event = JSON.parse(line) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (event.type === 'thread.started' && typeof event.thread_id === 'string') threadId = event.thread_id;
      if (event.type === 'item.completed' && event.item && typeof event.item === 'object') {
        const item = event.item as Record<string, unknown>;
        if (item.type === 'agent_message' && typeof item.text === 'string') finalResponse = item.text;
      }
      if (event.type === 'turn.completed' && event.usage && typeof event.usage === 'object') {
        usage = event.usage as CodexUsage;
      }
      if (event.type === 'turn.failed') {
        const error = event.error as { message?: unknown } | undefined;
        throw new ProviderTransportError(
          typeof error?.message === 'string' ? error.message : 'Codex CLI turn failed',
          undefined,
          looksRetryable(JSON.stringify(event)),
        );
      }
      if (event.type === 'error' && typeof event.message === 'string') {
        throw new ProviderTransportError(event.message, undefined, looksRetryable(event.message));
      }
    }
    if (!finalResponse) {
      throw new ProviderTransportError('Codex CLI produced no final agent message', undefined, false);
    }
    return {
      providerId: provider.id,
      modelId: model.id,
      content: finalResponse,
      ...(threadId ? { providerSessionId: threadId } : {}),
      finishReason: 'completed',
      usage: {
        ...(typeof usage?.input_tokens === 'number' ? { inputTokens: usage.input_tokens } : {}),
        ...(typeof usage?.cached_input_tokens === 'number' ? { cachedInputTokens: usage.cached_input_tokens } : {}),
        ...(typeof usage?.cache_write_input_tokens === 'number' ? { cacheWriteInputTokens: usage.cache_write_input_tokens } : {}),
        ...(typeof usage?.output_tokens === 'number' ? { outputTokens: usage.output_tokens } : {}),
        ...(typeof usage?.reasoning_output_tokens === 'number' ? { reasoningOutputTokens: usage.reasoning_output_tokens } : {}),
      },
      metadata: { bridge: 'codex-cli', sandbox: 'read-only', billingMode: 'subscription' },
    };
  }
}

interface ClaudeJsonResult {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  session_id?: string;
  total_cost_usd?: number;
  duration_ms?: number;
  num_turns?: number;
  usage?: {
    input_tokens?: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
    output_tokens?: number;
  };
}

function parseClaudeJson(stdout: string): ClaudeJsonResult {
  const trimmed = stdout.trim();
  try {
    return JSON.parse(trimmed) as ClaudeJsonResult;
  } catch {
    for (const raw of trimmed.split(/\r?\n/).reverse()) {
      try {
        return JSON.parse(raw) as ClaudeJsonResult;
      } catch {
        // Keep looking for the final JSON result if the CLI emitted a warning first.
      }
    }
  }
  throw new ProviderTransportError('Claude Code CLI returned invalid JSON output', undefined, false);
}

export class ClaudeCodeCliAdapter implements ProviderAdapter {
  public readonly providerId = 'claude-code-cli';

  public constructor(private readonly binary = 'claude') {}

  public async generate(
    provider: ProviderDefinition,
    model: ModelDefinition,
    request: PhoenixRequest,
    context?: { signal?: AbortSignal },
  ): Promise<PhoenixResponse> {
    const resume = sessionId(request);
    const requestedTurns = Number(request.metadata?.bridgeMaxTurns ?? '1');
    const maxTurns = Number.isFinite(requestedTurns) ? Math.max(1, Math.min(8, requestedTurns)) : 1;
    const args = [
      '-p',
      '--output-format',
      'json',
      '--permission-mode',
      'plan',
      '--max-turns',
      String(maxTurns),
      ...modelArgs(model),
      ...(resume ? ['--resume', resume] : []),
    ];
    const result = await runCli({
      binary: this.binary,
      args,
      input: renderBridgePrompt(request),
      ...(workingDirectory(request) ? { cwd: workingDirectory(request) } : {}),
      ...(context?.signal ? { signal: context.signal } : {}),
    });
    if (result.exitCode !== 0) {
      const detail = (result.stderr || result.stdout).slice(-4_000);
      throw new ProviderTransportError(
        `Claude Code CLI failed with exit ${result.exitCode}: ${detail}`,
        undefined,
        looksRetryable(detail),
      );
    }
    const payload = parseClaudeJson(result.stdout);
    if (payload.is_error || typeof payload.result !== 'string') {
      throw new ProviderTransportError(
        `Claude Code CLI did not return a successful result: ${result.stderr || result.stdout}`.slice(0, 4_000),
        undefined,
        looksRetryable(result.stderr || result.stdout),
      );
    }
    return {
      providerId: provider.id,
      modelId: model.id,
      content: payload.result,
      ...(payload.session_id ? { providerSessionId: payload.session_id } : {}),
      finishReason: payload.subtype ?? 'completed',
      usage: {
        ...(typeof payload.usage?.input_tokens === 'number' ? { inputTokens: payload.usage.input_tokens } : {}),
        ...(typeof payload.usage?.cache_read_input_tokens === 'number' ? { cachedInputTokens: payload.usage.cache_read_input_tokens } : {}),
        ...(typeof payload.usage?.cache_creation_input_tokens === 'number' ? { cacheWriteInputTokens: payload.usage.cache_creation_input_tokens } : {}),
        ...(typeof payload.usage?.output_tokens === 'number' ? { outputTokens: payload.usage.output_tokens } : {}),
        ...(typeof payload.total_cost_usd === 'number' ? { estimatedCostUsd: payload.total_cost_usd } : {}),
      },
      metadata: {
        bridge: 'claude-code-cli',
        permissionMode: 'plan',
        billingMode: 'subscription',
        ...(typeof payload.duration_ms === 'number' ? { durationMs: payload.duration_ms } : {}),
        ...(typeof payload.num_turns === 'number' ? { turns: payload.num_turns } : {}),
      },
    };
  }
}
