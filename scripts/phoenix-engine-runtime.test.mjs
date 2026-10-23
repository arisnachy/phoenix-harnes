import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { gzipSync } from 'node:zlib'
import { createServer } from 'node:http'

const require = createRequire(import.meta.url)
const { WebSocketServer } = require('ws')

import {
  activateOpenClawCandidate,
  ENGINE_RUNTIME_SAFETY_VERSION,
  inspectExecutionEngines,
  killWindowsProcessTreeForDiagnostics,
  prepareOpenClawOfficial,
  prepareOpenClawCandidate,
  rollbackOpenClawCandidate,
  runDefaultProcessForDiagnostics,
  stopDefaultProcessTreeForDiagnostics,
  startOpenClawGateway,
  stopOpenClawGateway,
} from './phoenix-engine-runtime.mjs'

const VERSION = '2026.8.1'
const OFFICIAL_VERSION = '2026.10.5'
const NODE_VERSION = '24.22.1'
const TARGET = 'a'.repeat(40)
const NEXT_TARGET = 'b'.repeat(40)

test('exports the hardened engine runtime safety contract version', () => {
  assert.equal(ENGINE_RUNTIME_SAFETY_VERSION, 2)
})

test('rejects a home or runtime root that traverses a symlink or junction', async (t) => {
  const f = fixture()
  try {
    const outside = join(f.root, 'outside')
    mkdirSync(outside, { recursive: true })
    const linkType = process.platform === 'win32' ? 'junction' : 'dir'
    const linkedHome = join(f.root, 'linked-home')
    try { symlinkSync(outside, linkedHome, linkType) } catch { t.skip('symlink/junction creation is unavailable in this environment'); return }
    await assert.rejects(() => inspectExecutionEngines({ home: linkedHome }), /safe directory|junction|reparse/u)
    const linkedRuntime = join(f.home, 'openclaw-runtime')
    rmSync(linkedRuntime, { recursive: true, force: true })
    symlinkSync(outside, linkedRuntime, linkType)
    await assert.rejects(() => inspectExecutionEngines({ home: f.home }), /safe directory|junction|reparse/u)
  } finally { dispose(f) }
})

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'phoenix-engine-runtime-'))
  const home = join(root, 'dsh')
  const phoenixRoot = join(root, 'phoenix')
  const control = join(root, 'control')
  const runtime = join(home, 'openclaw-runtime')
  mkdirSync(home, { recursive: true })
  mkdirSync(phoenixRoot, { recursive: true })
  mkdirSync(control, { recursive: true })
  mkdirSync(runtime, { recursive: true })
  mkdirSync(join(home, 'codex-cli', 'versions', '0.160.0'), { recursive: true })
  writeFileSync(join(home, 'codex-cli', 'versions', '0.160.0', 'codex.js'), 'codex fixture\n')
  writeFileSync(join(phoenixRoot, '.phoenix-managed-install'), '1\n')
  return { root, home, phoenixRoot, control, runtime }
}

function dispose(f) {
  rmSync(f.root, { recursive: true, force: true })
}

async function waitForPath(path, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (!existsSync(path) && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10))
  return existsSync(path)
}

async function waitForPidDead(pid, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if (error?.code === 'ESRCH') return true
      return false
    }
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  return false
}

function sha512(path) {
  return createHash('sha512').update(readFileSync(path)).digest('hex')
}

function sha512Buffer(value) {
  return createHash('sha512').update(value).digest('base64')
}

function sha256Buffer(value) {
  return createHash('sha256').update(value).digest('hex')
}

function candidateRegistryFetch(value) {
  const metadata = {
    name: 'openclaw',
    version: value.version,
    repository: { type: 'git', url: 'git+https://github.com/openclaw/openclaw.git' },
    dist: {
      tarball: value.registry.dist.tarball,
      integrity: `sha512-${Buffer.from(value.registry.dist.sha512, 'hex').toString('base64')}`,
    },
  }
  return async () => ({
    ok: true,
    status: 200,
    headers: new Headers({ 'content-length': String(Buffer.byteLength(JSON.stringify(metadata))) }),
    async arrayBuffer() { const bytes = Buffer.from(JSON.stringify(metadata)); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
  })
}

function openclawArchive(content) {
  const body = Buffer.from(content)
  const header = Buffer.alloc(512)
  header.write('package/openclaw.mjs', 0, 'utf8')
  header.write('0000644\0', 100, 'ascii')
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124, 'ascii')
  return gzipSync(Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512), Buffer.alloc(1024)]))
}

function candidate(f, overrides = {}) {
  const artifactPath = join(f.runtime, 'openclaw.tgz')
  const runtimePath = join(f.runtime, 'versions', VERSION)
  const entryPath = join(runtimePath, 'openclaw.mjs')
  const nodePath = join(f.runtime, 'node', 'fixture', 'node.exe')
  mkdirSync(runtimePath, { recursive: true })
  mkdirSync(join(f.runtime, 'node', 'fixture'), { recursive: true })
  writeFileSync(artifactPath, openclawArchive('export {}\n'))
  writeFileSync(entryPath, 'export {}\n')
  writeFileSync(nodePath, 'node fixture\n')
  return {
    version: VERSION,
    nodePath,
    entryPath,
    runtimePath,
    artifactPath,
    registry: {
      name: 'openclaw',
      version: VERSION,
      repository: 'openclaw/openclaw',
      dist: {
        tarball: `https://registry.npmjs.org/openclaw/-/openclaw-${VERSION}.tgz`,
        sha512: sha512(artifactPath),
      },
    },
    ...overrides,
  }
}

function nativeRunner({ exitCode = null } = {}) {
  const calls = []
  let exited = exitCode !== null
  const child = {
    pid: 4512,
    get exitCode() { return exited ? (exitCode ?? 0) : null },
    async kill() { await new Promise(resolve => setTimeout(resolve, 1)); exited = true },
  }
  return {
    calls,
    child,
    spawn(command, args, options) {
      calls.push({ command, args, options })
      return child
    },
    async health(command, args, options) {
      calls.push({ health: { command, args, options } })
      return { exitCode: 0, stdout: '{"status":"ok"}', stderr: '' }
    },
    async sleep() {},
    async waitForExit(value) {
      calls.push({ waitForExit: value.pid })
      while (value.exitCode === null) await new Promise(resolve => setTimeout(resolve, 1))
    },
    async kill(pid) {
      calls.push({ kill: pid })
      await child.kill()
    },
  }
}

function officialFetch({ metadata, shasums, nodeZip, tarball, oversized = false }) {
  const responses = new Map([
    [`https://registry.npmjs.org/openclaw/${OFFICIAL_VERSION}`, Buffer.from(JSON.stringify(metadata))],
    [`https://nodejs.org/dist/v${NODE_VERSION}/SHASUMS256.txt`, Buffer.from(shasums)],
    [`https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-win-x64.zip`, nodeZip],
    [metadata.dist.tarball, tarball],
  ])
  return async (url) => {
    const body = responses.get(url)
    if (body === undefined) throw new Error(`unexpected URL ${url}`)
    const bytes = oversized ? Buffer.alloc(128 * 1024 * 1024 + 1) : body
    return {
      ok: true,
      status: 200,
      headers: new Headers({ 'content-length': String(bytes.byteLength) }),
      async arrayBuffer() { return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) },
    }
  }
}

function officialRunner(f, calls, { npmResult } = {}) {
  return {
    ...nativeRunner(),
    async run(command, args, options, timeoutMs) {
      calls.push({ command, args, options, timeoutMs })
      if (args.includes('-EncodedCommand')) {
        const script = Buffer.from(args.at(-1), 'base64').toString('utf16le')
        assert.match(script, /Expand-Archive -LiteralPath/u)
        const destination = script.match(/-DestinationPath '([^']+)'/u)[1]
        const nodeRoot = join(destination, `node-v${NODE_VERSION}-win-x64`)
        mkdirSync(nodeRoot, { recursive: true })
        writeFileSync(join(nodeRoot, 'node.exe'), 'node fixture\n')
        writeFileSync(join(nodeRoot, 'npm.cmd'), '@echo off\n')
        return { exitCode: 0, stdout: '', stderr: '' }
      }
      if (String(command).endsWith('node.exe') && args[0] === '--version') return { exitCode: 0, stdout: `v${NODE_VERSION}\n`, stderr: '' }
      if (String(args[0]).endsWith('npm-cli.js')) {
        if (npmResult) return npmResult
        const prefix = args[args.indexOf('--prefix') + 1]
        const entry = join(prefix, 'node_modules', 'openclaw', 'openclaw.mjs')
        mkdirSync(join(prefix, 'node_modules', 'openclaw'), { recursive: true })
        writeFileSync(entry, 'export {}\n')
        return { exitCode: 0, stdout: 'installed\n', stderr: '' }
      }
      throw new Error(`unexpected command ${command}`)
    },
  }
}

test('inspectExecutionEngines unifies Phoenix active/update state and managed OpenClaw state', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.home, 'codex-cli', 'active.json'), JSON.stringify({ schema: 1, version: '0.160.0', bin: 'versions/0.160.0/codex.js' }))
    writeFileSync(join(f.control, 'phoenix-active-runtime.json'), JSON.stringify({ schema: 1, target: TARGET, path: f.phoenixRoot }))
    writeFileSync(join(f.control, 'phoenix-update-state.json'), JSON.stringify({ schema: 1, status: 'ready', phase: 'ready', target: NEXT_TARGET }))
    const result = await inspectExecutionEngines({ home: f.home, phoenixRoot: f.phoenixRoot, phoenixControlDirectory: f.control })
    assert.equal(result.schema, 1)
    assert.equal(result.updates.phoenix.marker, true)
    assert.equal(result.engines.codex.status, 'active')
    assert.equal(result.engines.codex.version, '0.160.0')
    assert.equal(result.engines.codex.bin.endsWith('codex.js'), true)
    assert.equal(result.updates.phoenix.activeRuntime.target, TARGET)
    assert.equal(result.engines.openclaw.status, 'unavailable')
    assert.doesNotMatch(JSON.stringify(result), /token|secret|api[_-]?key/i)
  } finally { dispose(f) }
})

test('prepareOpenClawCandidate pins official registry metadata and verifies dist sha512 on real files', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    const prepared = await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    assert.equal(prepared.status, 'prepared')
    assert.equal(prepared.retention.dryRun, true)
    assert.equal(prepared.retention.runtimeLockHeld, true)
    assert.equal(typeof prepared.retention.targetCount, 'number')
    assert.equal(JSON.parse(readFileSync(join(f.runtime, 'candidate.json'), 'utf8')).version, VERSION)
    const invalid = candidate(f, { registry: { ...value.registry, repository: 'evil/example' } })
    await assert.rejects(
      prepareOpenClawCandidate({ home: f.home, candidate: invalid, fetchImpl: candidateRegistryFetch(invalid) }),
      /independently fetched official registry metadata/u,
    )
    const outsideNode = candidate(f, { nodePath: process.execPath })
    await assert.rejects(
      prepareOpenClawCandidate({ home: f.home, candidate: outsideNode, fetchImpl: candidateRegistryFetch(outsideNode) }),
      /nodePath must stay/u,
    )
  } finally { dispose(f) }
})

test('retention applies only with explicit confirmation while the preparation lock is held', async () => {
  const f = fixture()
  try {
    const stale = join(f.runtime, 'versions', '2026.7.1')
    mkdirSync(stale, { recursive: true })
    writeFileSync(join(stale, 'old.txt'), 'stale\n')
    const value = candidate(f)
    const officialNodeRoot = join(f.runtime, 'node', `node-v${NODE_VERSION}-win-x64`)
    mkdirSync(officialNodeRoot, { recursive: true })
    writeFileSync(join(officialNodeRoot, 'node.exe'), 'node fixture\n')
    value.nodePath = join(officialNodeRoot, 'node.exe')
    const managedArtifact = join(f.runtime, 'artifacts', `openclaw-${VERSION}.tgz`)
    mkdirSync(join(f.runtime, 'artifacts'), { recursive: true })
    writeFileSync(managedArtifact, readFileSync(value.artifactPath))
    value.artifactPath = managedArtifact
    const prepared = await prepareOpenClawCandidate({
      home: f.home,
      candidate: value,
      fetchImpl: candidateRegistryFetch(value),
      applyRetention: true,
      retentionConfirm: true,
    })
    assert.equal(prepared.retention.dryRun, false)
    assert.equal(prepared.retention.runtimeLockHeld, true)
    assert.equal(prepared.retention.removedCount >= 1, true)
    assert.equal(existsSync(stale), false)
  } finally { dispose(f) }
})

test('prepareOpenClawOfficial downloads verified Node and OpenClaw artifacts into an isolated version directory', async () => {
  const f = fixture()
  try {
    const nodeZip = Buffer.from('verified node zip fixture\n')
    const tarball = openclawArchive('export {}\n')
    const metadata = {
      name: 'openclaw',
      version: OFFICIAL_VERSION,
      repository: { type: 'git', url: 'git+https://github.com/openclaw/openclaw.git' },
      dist: {
        tarball: `https://registry.npmjs.org/openclaw/-/openclaw-${OFFICIAL_VERSION}.tgz`,
        integrity: `sha512-${sha512Buffer(tarball)}`,
      },
    }
    const calls = []
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({
      schema: 1,
      status: 'active',
      version: '2026.8.0',
      runtimePath: join(f.runtime, 'versions', '2026.8.0'),
      entryPath: join(f.runtime, 'versions', '2026.8.0', 'openclaw.mjs'),
      nodePath: process.execPath,
      port: 18789,
    }))
    const prepared = await prepareOpenClawOfficial({
      home: f.home,
      version: OFFICIAL_VERSION,
      nodeVersion: NODE_VERSION,
      fetchImpl: officialFetch({
        metadata,
        shasums: `${sha256Buffer(nodeZip)} *node-v${NODE_VERSION}-win-x64.zip\n`,
        nodeZip,
        tarball,
      }),
      runner: officialRunner(f, calls),
    })

    assert.equal(prepared.status, 'prepared')
    assert.equal(prepared.candidate.version, OFFICIAL_VERSION)
    assert.equal(readFileSync(join(prepared.candidate.entryPath), 'utf8'), 'export {}\n')
    const persistedCandidate = JSON.parse(readFileSync(join(f.runtime, 'candidate.json'), 'utf8'))
    assert.equal(persistedCandidate.installedManifest.algorithm, 'sha256')
    assert.equal(persistedCandidate.nodeManifest.algorithm, 'sha256')
    assert.equal(persistedCandidate.nodeZipSha256, sha256Buffer(nodeZip))
    assert.equal(JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8')).version, '2026.8.0')
    const npm = calls.find(call => String(call.args[0]).endsWith('npm-cli.js'))
    assert.ok(npm)
    assert.equal(npm.args.includes('--ignore-scripts'), true)
    assert.equal(npm.args.includes('--omit=dev'), true)
    assert.equal(npm.args.includes('--no-audit'), true)
    assert.equal(npm.args.includes('--fund=false'), true)
    assert.equal(npm.options.env.OPENCLAW_GATEWAY_TOKEN, undefined)
    assert.equal(npm.options.env.NPM_CONFIG_USERCONFIG.endsWith('npmrc'), true)
  } finally { dispose(f) }
})

test('prepareOpenClawOfficial fails closed on an existing preparation lock', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.runtime, '.prepare.lock'), 'busy\n')
    await assert.rejects(
      prepareOpenClawOfficial({ home: f.home, version: OFFICIAL_VERSION, nodeVersion: NODE_VERSION }),
      /preparation is already in progress/u,
    )
  } finally { dispose(f) }
})

test('prepareOpenClawOfficial rejects oversized official responses before parsing or staging', async () => {
  const f = fixture()
  try {
    const tarball = openclawArchive('export {}\n')
    const metadata = {
      name: 'openclaw',
      version: OFFICIAL_VERSION,
      repository: { url: 'git+https://github.com/openclaw/openclaw.git' },
      dist: {
        tarball: `https://registry.npmjs.org/openclaw/-/openclaw-${OFFICIAL_VERSION}.tgz`,
        integrity: `sha512-${sha512Buffer(tarball)}`,
      },
    }
    await assert.rejects(
      prepareOpenClawOfficial({
        home: f.home,
        version: OFFICIAL_VERSION,
        nodeVersion: NODE_VERSION,
        fetchImpl: officialFetch({
          metadata,
          shasums: '',
          nodeZip: Buffer.from('node'),
          tarball,
          oversized: true,
        }),
        runner: officialRunner(f, []),
      }),
      /size limit/u,
    )
    assert.equal(existsSync(join(f.runtime, 'candidate.json')), false)
  } finally { dispose(f) }
})

test('prepareOpenClawOfficial distinguishes bounded npm timeout from a nonzero install exit', async () => {
  const cases = [
    { npmResult: { exitCode: null, stdout: '', stderr: '' }, code: 'OPENCLAW_NPM_INSTALL_TIMEOUT', message: /timed out/u },
    { npmResult: { exitCode: 37, stdout: '', stderr: 'install failed' }, code: 'OPENCLAW_NPM_INSTALL_FAILED', message: /exited with code 37/u },
  ]
  for (const item of cases) {
    const f = fixture()
    try {
      const nodeZip = Buffer.from('verified node zip fixture\n')
      const tarball = openclawArchive('export {}\n')
      const metadata = {
        name: 'openclaw',
        version: OFFICIAL_VERSION,
        repository: { type: 'git', url: 'git+https://github.com/openclaw/openclaw.git' },
        dist: {
          tarball: `https://registry.npmjs.org/openclaw/-/openclaw-${OFFICIAL_VERSION}.tgz`,
          integrity: `sha512-${sha512Buffer(tarball)}`,
        },
      }
      const calls = []
      await assert.rejects(
        prepareOpenClawOfficial({
          home: f.home,
          version: OFFICIAL_VERSION,
          nodeVersion: NODE_VERSION,
          installTimeoutMs: 321,
          fetchImpl: officialFetch({
            metadata,
            shasums: `${sha256Buffer(nodeZip)} *node-v${NODE_VERSION}-win-x64.zip\n`,
            nodeZip,
            tarball,
          }),
          runner: officialRunner(f, calls, item),
        }),
        error => error?.code === item.code && item.message.test(error.message),
      )
      const npm = calls.find(call => String(call.args[0]).endsWith('npm-cli.js'))
      assert.equal(npm.timeoutMs, 321)
    } finally { dispose(f) }
  }
})

test('prepareOpenClawOfficial retains the shared lock and durable block on uncertain process-tree cleanup', async () => {
  const f = fixture()
  try {
    const nodeZip = Buffer.from('verified node zip fixture\n')
    const tarball = openclawArchive('export {}\n')
    const metadata = {
      name: 'openclaw',
      version: OFFICIAL_VERSION,
      repository: { type: 'git', url: 'git+https://github.com/openclaw/openclaw.git' },
      dist: {
        tarball: `https://registry.npmjs.org/openclaw/-/openclaw-${OFFICIAL_VERSION}.tgz`,
        integrity: `sha512-${sha512Buffer(tarball)}`,
      },
    }
    const result = await prepareOpenClawOfficial({
      home: f.home,
      version: OFFICIAL_VERSION,
      nodeVersion: NODE_VERSION,
      fetchImpl: officialFetch({
        metadata,
        shasums: `${sha256Buffer(nodeZip)} *node-v${NODE_VERSION}-win-x64.zip\n`,
        nodeZip,
        tarball,
      }),
      runner: {
        async run() { return { exitCode: null, quiescent: false, ownedPid: 424242, treeStatus: 'uncertain' } },
      },
    })
    assert.equal(result.status, 'blocked')
    assert.equal(result.code, 'OPENCLAW_PROCESS_TREE_UNCERTAIN')
    assert.equal(result.pid, 424242)
    assert.equal(JSON.parse(readFileSync(join(f.runtime, '.runtime-blocked.json'), 'utf8')).pid, 424242)
    assert.equal(existsSync(join(f.runtime, '.runtime.lock')), true)
    const retry = await prepareOpenClawOfficial({ home: f.home, version: OFFICIAL_VERSION, nodeVersion: NODE_VERSION })
    assert.equal(retry.status, 'blocked')
    assert.equal(retry.code, 'OPENCLAW_PROCESS_TREE_UNCERTAIN')
  } finally { dispose(f) }
})

test('activateOpenClawCandidate defers while Phoenix executions are live and retains the prior marker on health failure', async () => {
  const f = fixture()
  try {
    const c = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: c, fetchImpl: candidateRegistryFetch(c) })
    const prior = { schema: 1, status: 'active', version: '2026.8.0', runtimePath: join(f.runtime, 'versions', '2026.8.0'), nodePath: process.execPath, entryPath: join(f.runtime, 'versions', '2026.8.0', 'openclaw.mjs'), port: 18789 }
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify(prior))
    for (const execution of [{ live: true }, { uncertain: true }, { phase: 'dispatching' }, { phases: ['running'] }]) {
      const deferred = await activateOpenClawCandidate({ home: f.home, execution })
      assert.equal(deferred.status, 'deferred')
      assert.equal(deferred.code, 'PHOENIX_EXECUTIONS_BUSY')
      assert.deepEqual(JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8')), prior)
    }
    const failed = await activateOpenClawCandidate({ home: f.home, runner: { ...nativeRunner(), health: async () => ({ exitCode: 1, stdout: '{"status":"failed"}', stderr: 'gateway unavailable' }) }, healthTimeoutMs: 50, healthIntervalMs: 1 })
    assert.equal(failed.status, 'blocked')
    assert.equal(failed.code, 'HEALTH_CHECK_FAILED')
    assert.deepEqual(JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8')), prior)
  } finally { dispose(f) }
})

test('default readiness uses bounded HTTP readiness without spawning another CLI', async () => {
  const f = fixture()
  let checks = 0
  const server = createServer((request, response) => {
    if (request.url !== '/readyz') {
      response.writeHead(404)
      response.end()
      return
    }
    checks++
    response.writeHead(checks === 1 ? 503 : 200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, status: checks === 1 ? 'draining' : 'ready' }))
  })
  writeFileSync(join(f.runtime, 'openclaw.json'), JSON.stringify({ gateway: { auth: { token: 'fixture-token' } } }))
  const gateway = new WebSocketServer({ server })
  gateway.on('connection', socket => {
    socket.send(JSON.stringify({ type: 'event', event: 'connect.challenge', payload: { nonce: 'fixture-challenge', ts: 1 } }))
    socket.on('message', raw => {
      const request = JSON.parse(raw.toString())
      if (request.method === 'connect') {
        socket.send(JSON.stringify({
          type: 'res',
          id: request.id,
          ok: true,
          payload: {
            type: 'hello-ok',
            protocol: 4,
            server: { version: 'fixture-gateway', connId: 'fixture-connection' },
            features: { methods: ['health'], events: ['health'] },
            auth: { role: 'operator', scopes: ['operator.read', 'operator.write'] },
            policy: { maxPayload: 1024 * 1024, maxBufferedBytes: 1024 * 1024, tickIntervalMs: 15000 },
          },
        }))
      } else if (request.method === 'health') {
        socket.send(JSON.stringify({ type: 'res', id: request.id, ok: true, payload: { status: 'ok' } }))
      }
    })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const runner = nativeRunner()
  delete runner.health
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    const result = await activateOpenClawCandidate({ home: f.home, runner, port: server.address().port, healthTimeoutMs: 5000, healthIntervalMs: 1 })
    assert.equal(result.status, 'activated')
    assert.ok(checks >= 2)
    assert.equal(runner.calls.filter(call => call.command).length, 1)
    await stopOpenClawGateway({ home: f.home, runner })
  } finally {
    await new Promise(resolve => gateway.close(resolve))
    await new Promise(resolve => server.close(resolve))
    dispose(f)
  }
})

test('default readiness fails closed when the host-private gateway auth config is missing', async () => {
  const f = fixture()
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({ ok: true, status: 'ready' }))
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const runner = nativeRunner()
  delete runner.health
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    const result = await activateOpenClawCandidate({ home: f.home, runner, port: server.address().port, healthTimeoutMs: 100, healthIntervalMs: 1 })
    assert.deepEqual(result, { status: 'blocked', code: 'HEALTH_CHECK_FAILED' })
  } finally {
    await new Promise(resolve => server.close(resolve))
    dispose(f)
  }
})

test('health readiness fails closed for empty or explicitly unsuccessful official JSON', async () => {
  for (const healthJson of ['{}', '{"ok":false,"status":"failed"}']) {
    const f = fixture()
    try {
      const value = candidate(f)
      await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
      const prior = { schema: 1, status: 'active', version: '2026.8.0', runtimePath: join(f.runtime, 'versions', '2026.8.0'), nodePath: process.execPath, entryPath: join(f.runtime, 'versions', '2026.8.0', 'openclaw.mjs'), port: 18789 }
      writeFileSync(join(f.runtime, 'active.json'), JSON.stringify(prior))
      const failed = await activateOpenClawCandidate({
        home: f.home,
        runner: { ...nativeRunner(), health: async () => ({ exitCode: 0, stdout: healthJson, stderr: '' }) },
        healthTimeoutMs: 10,
        healthIntervalMs: 1,
      })
      assert.equal(failed.status, 'blocked')
      assert.equal(failed.code, 'HEALTH_CHECK_FAILED')
      assert.deepEqual(JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8')), prior)
    } finally { dispose(f) }
  }
})

test('gateway readiness rejects a healthy probe when ownership verification fails', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    const runner = nativeRunner()
    runner.verifyGatewayOwnership = async () => false
    const result = await activateOpenClawCandidate({ home: f.home, runner, healthTimeoutMs: 20, healthIntervalMs: 1 })
    assert.deepEqual(result, { status: 'blocked', code: 'HEALTH_CHECK_FAILED' })
  } finally { dispose(f) }
})

test('activate, start, stop, and rollback use fixed loopback argv and scrub inherited secrets', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    const runner = nativeRunner()
    const activated = await activateOpenClawCandidate({ home: f.home, runner, port: 18789 })
    assert.equal(activated.status, 'activated')
    assert.equal(activated.retention.dryRun, true)
    assert.equal(activated.retention.runtimeLockHeld, true)
    assert.equal(JSON.parse(readFileSync(join(f.runtime, 'previous.json'), 'utf8')).status, 'none')
    const started = await startOpenClawGateway({ home: f.home, runner, port: 18789, env: { OPENCLAW_GATEWAY_TOKEN: 'must-not-cross', PATH: 'safe' } })
    assert.equal(started.status, 'ready')
    assert.deepEqual(runner.calls.findLast(call => call.command)?.args, [
      join(f.runtime, 'versions', VERSION, 'openclaw.mjs'), 'gateway', 'run', '--bind', 'loopback', '--port', '18789',
    ])
    const spawn = runner.calls.findLast(call => call.command)
    assert.equal(spawn.options.windowsHide, true)
    assert.equal(spawn.options.env.OPENCLAW_GATEWAY_TOKEN, undefined)
    assert.equal(spawn.options.env.PATH, 'safe')
    assert.equal(spawn.options.env.OPENCLAW_STATE_DIR, join(f.runtime, 'state'))
    assert.equal(spawn.options.env.OPENCLAW_CONFIG_PATH, join(f.runtime, 'openclaw.json'))
    const health = runner.calls.findLast(call => call.health)?.health
    assert.deepEqual(health.args, [join(f.runtime, 'versions', VERSION, 'openclaw.mjs'), 'health', '--json', '--timeout', '600000'])
    await stopOpenClawGateway({ home: f.home, runner })
    assert.equal(JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8')).status, 'stopped')
    assert.equal(runner.calls.some(call => call.waitForExit === 4512), true)
    const rolled = await rollbackOpenClawCandidate({ home: f.home, runner })
    assert.equal(rolled.status, 'rolled-back')
    assert.equal(rolled.retention.dryRun, true)
    assert.equal(rolled.retention.runtimeLockHeld, true)
  } finally { dispose(f) }
})

test('stop never kills a persisted PID after the owning process handle is gone', async () => {
  const f = fixture()
  try {
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({
      schema: 1,
      status: 'active',
      version: VERSION,
      runtimePath: join(f.runtime, 'versions', VERSION),
      nodePath: process.execPath,
      entryPath: join(f.runtime, 'versions', VERSION, 'openclaw.mjs'),
      port: 18789,
      pid: 4512,
    }))
    const runner = nativeRunner()
    const stopped = await stopOpenClawGateway({ home: f.home, runner })
    assert.deepEqual(stopped, { status: 'blocked', code: 'OPENCLAW_GATEWAY_OWNER_UNKNOWN' })
    assert.equal(runner.calls.some(call => call.kill !== undefined), false)
  } finally { dispose(f) }
})

function restartableRunner({ health = () => ({ exitCode: 0, stdout: '{"status":"ok"}', stderr: '' }) } = {}) {
  const calls = []
  let nextPid = 6000
  return {
    calls,
    spawn(command, args, options) {
      const state = { exited: false }
      const child = {
        pid: nextPid++,
        get exitCode() { return state.exited ? 0 : null },
        async kill() { state.exited = true },
      }
      calls.push({ command, args, options, child })
      return child
    },
    async health(command, args, options) {
      calls.push({ health: { command, args, options } })
      return health(command, args, options)
    },
    async sleep() {},
    async waitForExit(child) {
      calls.push({ waitForExit: child.pid })
      return child.exitCode !== null
    },
    async kill(pid) {
      calls.push({ kill: pid })
    },
  }
}

test('activation quiesces the owned gateway before binding the replacement', async () => {
  const f = fixture()
  try {
    const first = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: first, fetchImpl: candidateRegistryFetch(first) })
    const runner = restartableRunner()
    const activated = await activateOpenClawCandidate({ home: f.home, runner, port: 18789 })
    assert.equal(activated.status, 'activated')

    const second = candidate(f, { version: '2026.8.2' })
    second.registry.version = second.version
    second.registry.dist.tarball = `https://registry.npmjs.org/openclaw/-/openclaw-${second.version}.tgz`
    await prepareOpenClawCandidate({ home: f.home, candidate: second, fetchImpl: candidateRegistryFetch(second) })
    const replaced = await activateOpenClawCandidate({ home: f.home, runner, port: 18789 })
    assert.equal(replaced.status, 'activated')
    assert.equal(JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8')).version, '2026.8.2')
    assert.equal(runner.calls.some(call => call.waitForExit === 6000), true)
    assert.equal(runner.calls.filter(call => call.command).length, 2)
  } finally { dispose(f) }
})

test('failed replacement health restores the previously owned gateway and marker PID', async () => {
  const f = fixture()
  try {
    const first = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: first, fetchImpl: candidateRegistryFetch(first) })
    const runner = restartableRunner()
    await activateOpenClawCandidate({ home: f.home, runner, port: 18789 })
    const before = JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8'))

    const second = candidate(f, { version: '2026.8.2' })
    second.registry.version = second.version
    second.registry.dist.tarball = `https://registry.npmjs.org/openclaw/-/openclaw-${second.version}.tgz`
    await prepareOpenClawCandidate({ home: f.home, candidate: second, fetchImpl: candidateRegistryFetch(second) })
    const failing = restartableRunner({ health: async () => ({ exitCode: 1, stdout: '{"status":"failed"}', stderr: 'unavailable' }) })
    const result = await activateOpenClawCandidate({ home: f.home, runner: failing, healthTimeoutMs: 10, healthIntervalMs: 1 })
    assert.deepEqual(result, { status: 'blocked', code: 'HEALTH_CHECK_FAILED' })

    const after = JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8'))
    assert.equal(after.version, before.version)
    assert.equal(after.pid, 6001)
    assert.equal(runner.calls.filter(call => call.command).length, 2)
  } finally { dispose(f) }
})

test('replacement reports restore failure instead of claiming only the candidate health failure', async () => {
  const f = fixture()
  try {
    const first = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: first, fetchImpl: candidateRegistryFetch(first) })
    let healthy = true
    const runner = restartableRunner({ health: async () => healthy
      ? { exitCode: 0, stdout: '{"status":"ok"}', stderr: '' }
      : { exitCode: 1, stdout: '{"status":"failed"}', stderr: 'unavailable' } })
    await activateOpenClawCandidate({ home: f.home, runner, port: 18789 })

    const second = candidate(f, { version: '2026.8.2' })
    second.registry.version = second.version
    second.registry.dist.tarball = `https://registry.npmjs.org/openclaw/-/openclaw-${second.version}.tgz`
    await prepareOpenClawCandidate({ home: f.home, candidate: second, fetchImpl: candidateRegistryFetch(second) })
    healthy = false
    const result = await activateOpenClawCandidate({ home: f.home, runner, healthTimeoutMs: 10, healthIntervalMs: 1 })
    assert.deepEqual(result, { status: 'blocked', code: 'GATEWAY_RESTORE_HEALTH_FAILED' })
    assert.equal(JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8')).version, first.version)
  } finally { dispose(f) }
})

test('replacement blocks a persisted PID with no owned live process', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({ schema: 1, status: 'active', ...value, port: 18789, pid: 8888 }))
    const result = await activateOpenClawCandidate({ home: f.home })
    assert.deepEqual(result, { status: 'blocked', code: 'OPENCLAW_GATEWAY_OWNER_UNKNOWN' })
  } finally { dispose(f) }
})

test('gateway restart and shutdown defer without side effects for live or uncertain Phoenix work', async () => {
  const f = fixture()
  try {
    const marker = { schema: 1, status: 'active', version: '2026.10.6', port: 18789, pid: 4512 }
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify(marker))
    const runner = nativeRunner()
    for (const operation of [startOpenClawGateway, stopOpenClawGateway]) {
      for (const execution of [{ live: true }, { uncertain: true }, { phase: 'running' }]) {
        const result = await operation({ home: f.home, runner, execution })
        assert.deepEqual(result, { status: 'deferred', code: 'PHOENIX_EXECUTIONS_BUSY' })
        assert.deepEqual(JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8')), marker)
      }
    }
    assert.equal(runner.calls.length, 0)
  } finally { dispose(f) }
})

test('stop reports bounded quiescence timeout and retains the active marker', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    const runner = nativeRunner()
    const waits = []
    runner.waitForExit = async (value, timeoutMs) => {
      waits.push({ pid: value.pid, timeoutMs })
      return false
    }
    const activated = await activateOpenClawCandidate({ home: f.home, runner, port: 18789 })
    assert.equal(activated.status, 'activated')
    const stopped = await stopOpenClawGateway({ home: f.home, runner, stopTimeoutMs: 7 })
    assert.deepEqual(stopped, { status: 'blocked', code: 'GATEWAY_STOP_TIMEOUT' })
    assert.deepEqual(waits, [{ pid: 4512, timeoutMs: 7 }])
    assert.equal(JSON.parse(readFileSync(join(f.runtime, 'active.json'), 'utf8')).status, 'active')
  } finally { dispose(f) }
})

test('start re-verifies the active artifact before reusing or launching it', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({ schema: 1, status: 'active', ...value, port: 18789 }))
    writeFileSync(value.entryPath, 'tampered\n')
    const result = await startOpenClawGateway({ home: f.home, runner: nativeRunner() })
    assert.deepEqual(result, { status: 'blocked', code: 'ACTIVE_INVALID' })
  } finally { dispose(f) }
})

test('activation re-verifies the isolated Node digest manifest before launching', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({ schema: 1, status: 'active', ...value, port: 18789 }))
    writeFileSync(value.nodePath, 'tampered node fixture\n')
    const result = await startOpenClawGateway({ home: f.home, runner: nativeRunner() })
    assert.deepEqual(result, { status: 'blocked', code: 'ACTIVE_INVALID' })
  } finally { dispose(f) }
})

test('lifecycle operations serialize per isolated runtime', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({ schema: 1, status: 'active', ...value, port: 18789 }))
    const runner = nativeRunner()
    const results = await Promise.all([
      startOpenClawGateway({ home: f.home, runner }),
      startOpenClawGateway({ home: f.home, runner }),
    ])
    assert.deepEqual(results.map(result => result.status), ['ready', 'ready'])
    assert.equal(runner.calls.filter(call => call.command).length, 1)
  } finally { dispose(f) }
})

test('lifecycle refuses activation when another process owns the durable runtime lock', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({ schema: 1, status: 'active', ...value, port: 18789 }))
    writeFileSync(join(f.runtime, '.lifecycle.lock'), JSON.stringify({ pid: process.pid, token: 'foreign-owner', startedAt: new Date().toISOString() }))
    const result = await startOpenClawGateway({ home: f.home, runner: nativeRunner() })
    assert.deepEqual(result, { status: 'blocked', code: 'OPENCLAW_LIFECYCLE_BUSY' })
  } finally { dispose(f) }
})

test('lifecycle publishes canonical and legacy lock fences only while it owns the shared lock', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({ schema: 1, status: 'active', ...value, port: 18789 }))
    const runner = nativeRunner()
    runner.health = async () => {
      assert.equal(existsSync(join(f.runtime, '.runtime.lock')), true)
      assert.equal(existsSync(join(f.runtime, '.prepare.lock')), true)
      assert.equal(existsSync(join(f.runtime, '.lifecycle.lock')), true)
      return { exitCode: 0, stdout: '{"status":"ok"}', stderr: '' }
    }
    const result = await startOpenClawGateway({ home: f.home, runner })
    assert.equal(result.status, 'ready')
    assert.equal(existsSync(join(f.runtime, '.runtime.lock')), false)
    assert.equal(existsSync(join(f.runtime, '.prepare.lock')), false)
    assert.equal(existsSync(join(f.runtime, '.lifecycle.lock')), false)
  } finally { dispose(f) }
})

test('lifecycle recovers a durable lock only after the owner PID is definitely dead', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({ schema: 1, status: 'active', ...value, port: 18789 }))
    writeFileSync(join(f.runtime, '.runtime.lock'), JSON.stringify({ schema: 1, pid: 2147483647, token: 'stale-owner', startedAt: new Date().toISOString() }))
    const result = await startOpenClawGateway({ home: f.home, runner: nativeRunner() })
    assert.equal(result.status, 'ready')
    assert.equal(result.version, VERSION)
    assert.equal(result.port, 18789)
    assert.equal(existsSync(join(f.runtime, '.runtime.lock')), false)
  } finally { dispose(f) }
})

test('lifecycle refuses stale-lock recovery while the recovery guard is present', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({ schema: 1, status: 'active', ...value, port: 18789 }))
    writeFileSync(join(f.runtime, '.runtime.lock'), JSON.stringify({ schema: 1, pid: 2147483647, token: 'stale-owner', startedAt: new Date().toISOString() }))
    writeFileSync(join(f.runtime, '.runtime.lock.recovery'), JSON.stringify({ schema: 1, pid: process.pid, token: 'live-recovery', kind: 'recovery' }))
    const result = await startOpenClawGateway({ home: f.home, runner: nativeRunner() })
    assert.deepEqual(result, { status: 'blocked', code: 'OPENCLAW_LIFECYCLE_BUSY' })
    assert.equal(existsSync(join(f.runtime, '.runtime.lock')), true)
    assert.equal(existsSync(join(f.runtime, '.runtime.lock.recovery')), true)
  } finally { dispose(f) }
})

test('lifecycle preserves a dead recovery guard for exclusive operator repair', async () => {
  const f = fixture()
  try {
    const value = candidate(f)
    await prepareOpenClawCandidate({ home: f.home, candidate: value, fetchImpl: candidateRegistryFetch(value) })
    writeFileSync(join(f.runtime, 'active.json'), JSON.stringify({ schema: 1, status: 'active', ...value, port: 18789 }))
    writeFileSync(join(f.runtime, '.runtime.lock'), JSON.stringify({ schema: 1, pid: 2147483647, token: 'stale-owner', startedAt: new Date().toISOString() }))
    writeFileSync(join(f.runtime, '.runtime.lock.recovery'), JSON.stringify({ schema: 1, pid: 2147483647, token: 'stale-recovery', kind: 'recovery' }))
    const result = await startOpenClawGateway({ home: f.home, runner: nativeRunner() })
    assert.equal(result.status, 'blocked')
    assert.equal(existsSync(join(f.runtime, '.runtime.lock.recovery')), true)
  } finally { dispose(f) }
})

test('Windows timeout proves owned parent and descendant quiescence before returning', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture()
  const pidFile = join(f.root, 'owned-tree-pids.json')
  try {
    const pidFileLiteral = JSON.stringify(pidFile)
    const script = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const descendant = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 5000)'], { stdio: 'ignore', windowsHide: true })",
      `writeFileSync(${pidFileLiteral}, JSON.stringify({ parent: process.pid, descendant: descendant.pid }))`,
      'setTimeout(() => process.exit(0), 5000)',
    ].join(';')
    const result = await runDefaultProcessForDiagnostics(process.execPath, ['-e', script], {
      cwd: f.root,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'ignore', 'ignore'],
    }, 150)
    assert.equal(await waitForPath(pidFile), true)
    const pids = JSON.parse(readFileSync(pidFile, 'utf8'))
    assert.equal(result.quiescent, true)
    assert.equal(result.treeStatus, 'quiescent')
    assert.equal(await waitForPidDead(pids.parent), true)
    assert.equal(await waitForPidDead(pids.descendant), true)
  } finally {
    // The fixture children have bounded self-exit timers. No arbitrary PID is
    // killed here; cleanup only removes this test's temporary files.
    dispose(f)
  }
})

test('Windows natural parent close with a live descendant remains uncertain', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture()
  const pidFile = join(f.root, 'natural-tree-pids.json')
  const stopFile = join(f.root, 'stop-owned-fixture')
  let pids
  try {
    const descendant = `const {existsSync}=require('node:fs'); setInterval(()=>{if(existsSync(${JSON.stringify(stopFile)}))process.exit(0)},50); setTimeout(()=>process.exit(0),60000)`
    const script = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      `const descendant = spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], { stdio: 'ignore', windowsHide: true })`,
      `writeFileSync(${JSON.stringify(pidFile)}, JSON.stringify({ parent: process.pid, descendant: descendant.pid }))`,
      'setTimeout(() => process.exit(0), 100)',
    ].join(';')
    const result = await runDefaultProcessForDiagnostics(process.execPath, ['-e', script], {
      cwd: f.root, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
    }, 3000)
    assert.equal(await waitForPath(pidFile), true)
    pids = JSON.parse(readFileSync(pidFile, 'utf8'))
    if (result.quiescent) {
      assert.equal(await waitForPidDead(pids.descendant), true)
    } else {
      assert.equal(result.treeStatus, 'uncertain')
    }
    assert.equal(Number.isInteger(pids.descendant), true)
  } finally {
    // Only the fixture child watches this unique, test-owned stop signal.
    writeFileSync(stopFile, 'stop')
    if (pids?.descendant) await waitForPidDead(pids.descendant)
    dispose(f)
  }
})

test('Windows natural completion accepts descendants that have already exited', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture()
  try {
    const script = [
      "const { spawn } = require('node:child_process')",
      "spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 1500)'], { stdio: 'ignore', windowsHide: true })",
      'setTimeout(() => process.exit(0), 3000)',
    ].join(';')
    const result = await runDefaultProcessForDiagnostics(process.execPath, ['-e', script], {
      cwd: f.root, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'],
    }, 10000)
    assert.equal(result.exitCode, 0)
    assert.equal(result.quiescent, true)
  } finally { dispose(f) }
})

test('Windows gateway stop proves owned descendants are quiescent before returning', { skip: process.platform !== 'win32' }, async () => {
  const f = fixture()
  const pidFile = join(f.root, 'stop-tree-pids.json')
  let child
  try {
    const pidFileLiteral = JSON.stringify(pidFile)
    const script = [
      "const { spawn } = require('node:child_process')",
      "const { writeFileSync } = require('node:fs')",
      "const descendant = spawn(process.execPath, ['-e', 'setTimeout(() => process.exit(0), 5000)'], { stdio: 'ignore', windowsHide: true })",
      `writeFileSync(${pidFileLiteral}, JSON.stringify({ parent: process.pid, descendant: descendant.pid }))`,
      'setTimeout(() => process.exit(0), 5000)',
    ].join(';')
    child = spawn(process.execPath, ['-e', script], { cwd: f.root, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] })
    assert.equal(await waitForPath(pidFile), true)
    const pids = JSON.parse(readFileSync(pidFile, 'utf8'))
    const stopped = await stopDefaultProcessTreeForDiagnostics(child, 3000)
    // A missing Windows process-table snapshot must remain fail-closed. When
    // the native proof is available, require the descendant to be gone too.
    assert.equal(typeof stopped, 'boolean')
    assert.equal(await waitForPidDead(pids.parent), true)
    if (stopped) assert.equal(await waitForPidDead(pids.descendant), true)
  } finally {
    if (child && !child.killed) {
      try { child.kill() } catch { /* bounded fixture cleanup only */ }
    }
    dispose(f)
  }
})

test('Windows taskkill helper timeout settles as uncertain', { skip: process.platform !== 'win32' }, async () => {
  const helper = new EventEmitter()
  let helperStopped = false
  helper.kill = () => { helperStopped = true }
  const startedAt = Date.now()
  const result = await killWindowsProcessTreeForDiagnostics(123456789, 20, () => helper)
  assert.equal(result, false)
  assert.equal(helperStopped, true)
  assert.ok(Date.now() - startedAt < 1000)
})
