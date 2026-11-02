/** Read-only Codex app-server voice diagnostic: ChatGPT login, experimental API; no mic or API key. */
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

export function managedCodexBin(home) {
  const directory = resolve(home, 'codex-cli')
  try {
    const marker = JSON.parse(readFileSync(join(directory, 'active.json'), 'utf8'))
    if (marker?.schema !== 1 || typeof marker.bin !== 'string'
      || !/^\d+\.\d+\.\d+$/.test(marker.version)) return undefined
    const entry = resolve(directory, marker.bin)
    if (!entry.startsWith(`${directory}${sep}`) || !/\.m?js$/i.test(entry) || !existsSync(entry)) return undefined
    return { entry, version: marker.version }
  } catch { return undefined }
}

export function classifyVoiceFailure(value) {
  const message = String(value instanceof Error ? value.message : value)
  if (/invalid_quicksilver_alpha_header|AVAS requires OpenAI-Alpha/i.test(message)) return 'quicksilver-v2-rejected'
  if (/403|access denied|forbidden/i.test(message)) return 'voice-access-denied'
  if (/login required|not authenticated|refresh token|unauthorized|401/i.test(message)) return 'codex-login-required'
  if (/requires experimentalApi|unknown method|method not found|unsupported/i.test(message)) return 'realtime-experimental-unavailable'
  if (/timeout|timed out|ETIMEDOUT/i.test(message)) return 'app-server-timeout'
  if (/ECONN|ENOTFOUND|network|fetch failed/i.test(message)) return 'network-unavailable'
  return 'app-server-error'
}

/** Never access stored tokens. These queries verify app-server RPC support, not a live WebRTC call. */
export async function inspectCodexLive({
  home = process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'),
  timeoutMs = 20_000,
  spawnProcess = spawn,
} = {}) {
  const managed = managedCodexBin(home)
  if (managed === undefined) return { status: 'managed-codex-not-found', authenticated: false, experimentalRealtime: false, webrtcVerified: false }
  const env = { ...process.env }
  delete env.OPENAI_API_KEY
  delete env.PHOENIX_CODEX_SQLITE_HOME
  const codexHome = resolve(env.CODEX_HOME?.trim() || join(homedir(), '.codex'))
  env.CODEX_HOME = codexHome
  env.CODEX_SQLITE_HOME = codexHome
  const output = { cliVersion: managed.version, authenticated: false, experimentalRealtime: false, webrtcVerified: false }
  const args = [managed.entry,
    '-c', "forced_login_method='chatgpt'",
    '-c', 'features.realtime_conversation=true',
    '-c', 'features.plugins=false',
    '-c', 'skills.bundled.enabled=false',
    '-c', `sqlite_home=${JSON.stringify(codexHome)}`,
    'app-server', '--stdio']
  let child
  try {
    child = spawnProcess(process.execPath, args, { env, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
  } catch (error) { return { ...output, status: classifyVoiceFailure(error) } }
  let nextId = 0
  let buffer = ''
  let closed = false
  const pending = new Map()
  const rejectAll = (reason) => {
    closed = true
    for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(new Error(reason)); pending.delete(id) }
  }
  child.on('error', () => rejectAll('app-server process failed'))
  child.on('exit', () => rejectAll('app-server process exited'))
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    if (buffer.length > 1024 * 1024) { rejectAll('app-server response exceeded limit'); return }
    let newline
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        const p = pending.get(String(message.id))
        if (!p) continue
        pending.delete(String(message.id))
        clearTimeout(p.timer)
        if (message.error) p.reject(new Error(String(message.error.message || 'app-server RPC failed')))
        else p.resolve(message.result)
      } catch { /* ignore unrelated notifications and malformed frames */ }
    }
  })
  const request = (method, params) => new Promise((resolvePromise, rejectPromise) => {
    if (closed) { rejectPromise(new Error('app-server exited')); return }
    const id = String(++nextId)
    const timer = setTimeout(() => { pending.delete(id); rejectPromise(new Error('app-server RPC timed out')) }, timeoutMs)
    pending.set(id, { resolve: resolvePromise, reject: rejectPromise, timer })
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, (error) => {
      if (!error) return
      const p = pending.get(id)
      if (p) { clearTimeout(p.timer); pending.delete(id); p.reject(error) }
    })
  })
  try {
    await request('initialize', { clientInfo: { name: 'phoenix_voice_doctor', title: 'Phoenix Codex Voice Doctor', version: '1' }, capabilities: { experimentalApi: true, requestAttestation: false } })
    child.stdin.write(`${JSON.stringify({ method: 'initialized' })}\n`)
    const account = await request('account/read', { refreshToken: false })
    if (account?.account?.type !== 'chatgpt') return { ...output, status: 'codex-login-required' }
    output.authenticated = true
    await request('thread/realtime/listVoices', {})
    output.experimentalRealtime = true
    return { ...output, status: 'experimental-protocol-ready', note: 'WebRTC/Quicksilver session creation cannot be proven without a browser SDP call.' }
  } catch (error) { return { ...output, status: classifyVoiceFailure(error) } }
  finally {
    rejectAll('voice doctor completed')
    if (!child.killed) child.kill()
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await inspectCodexLive()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exitCode = result.status === 'experimental-protocol-ready' ? 0 : 1
}
