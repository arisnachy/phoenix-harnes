import type { ToolExecutionResult } from '@deepseek-ai/dsh-tools'
import type {
  OpenClawIsolatedExecutionRequest,
  OpenClawIsolatedRunner,
} from './installed-installer.ts'

interface OutputRead {
  readonly text: string
}
interface OutputReader {
  readFrom(offset: number): OutputRead
}
interface SubprocessHandleLike {
  readonly done: Promise<{ readonly exitCode: number | null; readonly signal: string | null }>
  readonly collected: { readonly stdout?: OutputReader; readonly stderr?: OutputReader }
}
export interface OpenClawSubprocessRuntime {
  resolveExecutable(command: string, env?: Readonly<Record<string, string>>, signal?: AbortSignal): Promise<string>
  spawn(spec: {
    readonly argv: readonly string[]
    readonly cwd: string
    readonly stdio: {
      readonly stdin: { readonly data: string }
      readonly stdout: { readonly maxBytes: number }
      readonly stderr: { readonly maxBytes: number }
    }
    readonly graceMs: number
    readonly signal?: AbortSignal
    readonly env?: NodeJS.ProcessEnv
  }): SubprocessHandleLike
}

export interface OpenClawSandboxRuntime {
  confine(argv: readonly string[], policy: {
    readonly mode: 'read-only'
    readonly workspaceRoot: string
  }): {
    readonly argv: readonly string[]
    readonly enforcement: 'full' | 'partial'
  }
}

export interface OpenClawIsolatedRunnerOptions {
  readonly subprocess: OpenClawSubprocessRuntime
  readonly sandbox: OpenClawSandboxRuntime
  readonly workspaceRoot: string
}

const RESULT_PREFIX = 'PHOENIX_OPENCLAW_RESULT='
const OUTPUT_LIMIT = 1024 * 1024

const WORKER_SOURCE = String.raw`
import { pathToFileURL } from 'node:url';

const RESULT_PREFIX = ${JSON.stringify(RESULT_PREFIX)};
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));

function printable(value) {
  if (value === undefined) return null;
  if (typeof value === 'bigint') return value.toString();
  try { return JSON.parse(JSON.stringify(value)); } catch { return String(value); }
}

function result(ok, value, message) {
  const payload = ok
    ? { isError: false, value: printable(value), content: [] }
    : { isError: true, content: [{ type: 'text', text: message ?? 'OpenClaw execution failed' }] };
  process.stdout.write(RESULT_PREFIX + JSON.stringify(payload) + '\n');
}

const registrations = new Map();
function capture(name, value) {
  const values = registrations.get(name) ?? [];
  values.push(value);
  registrations.set(name, values);
}
const log = { debug() {}, info() {}, warn() {}, error() {} };
const memoryStore = new Map();
const keyedStore = {
  async get(key) { return memoryStore.get(String(key)); },
  async set(key, value) { memoryStore.set(String(key), value); },
  async delete(key) { return memoryStore.delete(String(key)); },
  async entries() { return [...memoryStore.entries()]; },
};
const runtime = new Proxy({
  config: { current: () => ({}) },
  state: { openKeyedStore: () => keyedStore },
  llm: { acquireLocalService: async () => undefined },
  logging: { shouldLogVerbose: () => false },
}, {
  get(target, prop) {
    if (prop in target) return target[prop];
    return new Proxy({}, { get: () => () => undefined });
  },
});
const nestedFacade = new Proxy({}, { get: () => () => undefined });
const baseApi = {
  id: request.extensionId,
  name: request.extensionId,
  source: request.entryPath,
  registrationMode: 'capabilities',
  pluginConfig: {},
  config: {},
  runtime,
  logger: log,
  lifecycle: nestedFacade,
  agent: nestedFacade,
  session: nestedFacade,
};
const api = new Proxy(baseApi, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop !== 'string') return undefined;
    if (prop.startsWith('register')) {
      return (...args) => capture(prop, args[0]);
    }
    return undefined;
  },
});

function values(name) { return registrations.get(name) ?? []; }
function executable(candidate) {
  return candidate && typeof candidate === 'object' && typeof candidate.execute === 'function';
}
async function materializeTool(candidate) {
  if (executable(candidate)) return candidate;
  if (typeof candidate !== 'function') return undefined;
  const contexts = [
    { config: {}, searchConfig: {}, runtime, logger: log },
    { config: {}, runtime, logger: log },
    {},
  ];
  for (const context of contexts) {
    try {
      const tool = await candidate(context);
      if (executable(tool)) return tool;
    } catch {}
  }
  return undefined;
}
async function invokeTool(tool) {
  try {
    if (request.registrationFamily === 'web-search') {
      return await tool.execute(request.args, { signal: undefined });
    }
    return await tool.execute(request.callId, request.args, undefined);
  } catch (first) {
    try { return await tool.execute(request.args, { signal: undefined }); }
    catch { throw first; }
  }
}
function methodAt(root, path) {
  if (!root || typeof root !== 'object' || typeof path !== 'string' || path.length === 0) return undefined;
  const parts = path.split('.');
  let owner = root;
  for (let index = 0; index < parts.length - 1; index += 1) {
    owner = owner?.[parts[index]];
    if (!owner || typeof owner !== 'object') return undefined;
  }
  const fn = owner?.[parts[parts.length - 1]];
  return typeof fn === 'function' ? { owner, fn } : undefined;
}

try {
  const mod = await import(pathToFileURL(request.entryPath).href);
  const plugin = mod.default ?? mod.plugin ?? mod;
  if (plugin && typeof plugin.register === 'function') await plugin.register(api);
  else if (plugin && typeof plugin.registerCapabilities === 'function') await plugin.registerCapabilities(api);
  else if (typeof plugin === 'function') await plugin(api);
  else throw new Error('OpenClaw entrypoint exposes no supported registration function');

  if (request.registrationFamily === 'web-search') {
    const provider = values('registerWebSearchProvider')[0];
    if (provider && typeof provider.createTool === 'function') {
      const tool = provider.createTool({ config: {}, searchConfig: {} });
      result(true, await tool.execute(request.args, { signal: undefined }));
      process.exit(0);
    }
  }

  if (request.registrationFamily === 'computer-use' || request.registrationFamily === 'device') {
    const commands = values('registerNodeHostCommand');
    const args = request.args && typeof request.args === 'object' ? request.args : {};
    const action = typeof args.action === 'string' ? args.action : undefined;
    const commandName = action === 'screenshot' ? 'screen.snapshot' : 'computer.act';
    const command = commands.find(item => item?.command === commandName) ?? commands[0];
    if (command && typeof command.handle === 'function') {
      const text = await command.handle(JSON.stringify(args), undefined, {
        signal: undefined,
        sendNodeEvent: async () => undefined,
      });
      try { result(true, JSON.parse(text)); } catch { result(true, text); }
      process.exit(0);
    }
  }

  for (const candidate of values('registerTool')) {
    const tool = await materializeTool(candidate);
    if (tool) {
      result(true, await invokeTool(tool));
      process.exit(0);
    }
  }

  const familyRegistrations = request.registrationFamily === 'channel'
    ? values('registerChannel')
    : request.registrationFamily === 'provider'
      ? values('registerProvider')
      : request.registrationFamily === 'memory'
        ? [...values('registerMemoryCapability'), ...values('registerTool')]
        : [];
  const operation = request.args && typeof request.args === 'object' && typeof request.args.operation === 'string'
    ? request.args.operation
    : undefined;
  if (operation) {
    for (const candidate of familyRegistrations) {
      const callable = methodAt(candidate, operation);
      if (!callable) continue;
      const payload = { ...request.args };
      delete payload.operation;
      result(true, await callable.fn.call(callable.owner, payload));
      process.exit(0);
    }
  }

  result(false, null, 'OpenClaw extension registered successfully but exposes no PHOENIX-compatible executor for family ' + request.registrationFamily);
} catch (error) {
  result(false, null, error instanceof Error ? error.message : String(error));
}
`

function executionFailure(message: string): ToolExecutionResult {
  return {
    isError: true,
    error: new Error(message),
    content: [{ type: 'text', text: message }],
  }
}

function parseWorkerResult(stdout: string, stderr: string): ToolExecutionResult {
  const line = stdout.split(/\r?\n/u).reverse().find(candidate => candidate.startsWith(RESULT_PREFIX))
  if (line === undefined) {
    return executionFailure(`OpenClaw worker returned no typed result${stderr.trim().length === 0 ? '' : `: ${stderr.trim()}`}`)
  }
  try {
    const parsed = JSON.parse(line.slice(RESULT_PREFIX.length)) as ToolExecutionResult
    if (typeof parsed.isError !== 'boolean' || !Array.isArray(parsed.content)) throw new Error('invalid result shape')
    if (parsed.isError) {
      const text = parsed.content.find(block => block.type === 'text')?.text
      return executionFailure(typeof text === 'string' && text.length > 0 ? text : 'OpenClaw execution failed')
    }
    return parsed
  } catch (error) {
    return executionFailure(`OpenClaw worker emitted an invalid typed result: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * Build an isolated OpenClaw runner over the canonical PHOENIX subprocess and sandbox seams.
 * Donor code runs in a short-lived child with the subprocess service's scrubbed parent environment.
 */
export function createOpenClawIsolatedRunner(options: OpenClawIsolatedRunnerOptions): OpenClawIsolatedRunner {
  return {
    execute: async (request: OpenClawIsolatedExecutionRequest, signal: AbortSignal): Promise<ToolExecutionResult> => {
      const node = await options.subprocess.resolveExecutable('node', undefined, signal)
      const confined = options.sandbox.confine(
        [node, '--input-type=module', '--eval', WORKER_SOURCE],
        { mode: 'read-only', workspaceRoot: options.workspaceRoot },
      )
      if (confined.enforcement !== 'full') {
        return executionFailure('OpenClaw donor execution requires full PHOENIX sandbox enforcement')
      }

      const handle = options.subprocess.spawn({
        argv: confined.argv,
        cwd: options.workspaceRoot,
        stdio: {
          stdin: { data: JSON.stringify(request) },
          stdout: { maxBytes: OUTPUT_LIMIT },
          stderr: { maxBytes: OUTPUT_LIMIT },
        },
        graceMs: 5_000,
        signal,
        env: { PHOENIX_OPENCLAW_WORKER: '1' },
      })
      const outcome = await handle.done
      const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
      const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
      const result = parseWorkerResult(stdout, stderr)
      if (outcome.exitCode !== 0 && !result.isError) {
        return executionFailure(`OpenClaw worker exited with ${String(outcome.exitCode)} after emitting a success result`)
      }
      return result
    },
  }
}
