#!/usr/bin/env node
/**
 * PHOENIX local image MCP bridge. FLUX.2 Klein runs in a separate FastSD CPU
 * OpenVINO process, never inside Ollama or Eclipse.
 *
 * MCP stdio is JSON-lines. No generated base64 is passed to a text-only LLM:
 * images persist under a private local root and are served by PHOENIX Web.
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync, readFileSync, lstatSync, realpathSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import process from 'node:process'

export const FASTSD_MODEL = 'rupeshs/flux2-klein-4b-int4-ov'
export const FASTSD_REVISION = 'ae7208c030f9a1fe5abb0d8af5d8976abce3417f'
const LEGACY_REPO = 'models--rupeshs--sd-turbo-openvino'
export const FASTSD_SIZE = 512
const THIS = fileURLToPath(import.meta.url)
const PROJECT_ROOT = resolve(dirname(THIS), '..')
const APP_ROOT = process.env.LOCALAPPDATA
  ? join(process.env.LOCALAPPDATA, 'PHOENIX')
  : join(homedir(), '.phoenix')
export const imageRoot = () => resolve(process.env.PHOENIX_LOCAL_IMAGE_HOME || join(APP_ROOT, 'images'))
export const legacyFastsdRoot = () => resolve(process.env.PHOENIX_FASTSD_HOME || join(APP_ROOT, 'fastsdcpu'))
export const fastsdRoot = () => legacyFastsdRoot() + '-flux2'
const readyFile = () => join(fastsdRoot(), '.phoenix-fastsd-ready')
const verifiedFile = () => join(fastsdRoot(), '.phoenix-flux2-verified')
const migratedFile = () => join(fastsdRoot(), '.phoenix-flux2-migrated')
function ready() {
  try { return readFileSync(readyFile(), 'utf8').trim() === FASTSD_REVISION } catch { return false }
}
export function legacyCacheCandidates(home, legacyRoot, env = process.env) {
  // Do not touch explicitly shared/custom caches: ownership is unknown.
  const owned = [join(legacyRoot, 'hub', LEGACY_REPO), join(legacyRoot, 'cache', 'hub', LEGACY_REPO)]
  if (!env.HF_HOME && !env.HF_HUB_CACHE && !env.HUGGINGFACE_HUB_CACHE && !env.XDG_CACHE_HOME) {
    owned.push(join(home, '.cache', 'huggingface', 'hub', LEGACY_REPO))
  }
  return owned
}
function retireLegacyModel() {
  if (!existsSync(verifiedFile()) || !existsSync(join(legacyFastsdRoot(), '.phoenix-fastsd-ready'))) return
  for (const target of legacyCacheCandidates(homedir(), legacyFastsdRoot())) {
    if (!existsSync(target)) continue
    // Refuse junctions/symlinks anywhere along the resolved target.
    const actual = realpathSync(target)
    const equivalent = process.platform === 'win32'
      ? actual.toLowerCase() === resolve(target).toLowerCase() : actual === resolve(target)
    if (!equivalent || !lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink()) {
      throw new Error('No se retiró una caché SD Turbo redirigida: ' + target)
    }
    rmSync(target, { recursive: true, force: true })
  }
  writeFileSync(migratedFile(), FASTSD_REVISION + '\n')
}
const portValue = Number(process.env.PHOENIX_FASTSD_PORT ?? 18765)
const PORT = Number.isInteger(portValue) && portValue > 1024 && portValue <= 65535 ? portValue : 18765
const ORIGIN = 'http://127.0.0.1:' + PORT
const TIMEOUT_MS = 13 * 60_000
let backend
let idleTimer
let backendStart
let queue = Promise.resolve()

export function generationRequest(prompt, extra = {}) {
  const clean = String(prompt ?? '').trim()
  if (!clean || clean.length > 3000) throw new Error('Describe la imagen en un texto de 1 a 3000 caracteres.')
  const seed = extra.seed
  if (seed !== undefined && (!Number.isSafeInteger(seed) || seed < 0 || seed > 2147483647)) {
    throw new Error('La semilla debe ser un entero entre 0 y 2147483647.')
  }
  const negative = extra.negative_prompt === undefined ? '' : String(extra.negative_prompt)
  if (negative.length > 1000) throw new Error('El prompt negativo supera 1000 caracteres.')
  return {
    prompt: clean,
    negative_prompt: negative,
    use_openvino: true,
    openvino_lcm_model_id: FASTSD_MODEL,
    use_lcm_lora: false,
    use_tiny_auto_encoder: false,
    image_height: FASTSD_SIZE,
    image_width: FASTSD_SIZE,
    inference_steps: 4,
    guidance_scale: 1,
    number_of_images: 1,
    diffusion_task: 'text_to_image',
    use_seed: seed !== undefined,
    ...(seed === undefined ? {} : { seed }),
  }
}

async function probe() {
  try {
    const response = await fetch(ORIGIN + '/api/models', { signal: AbortSignal.timeout(1500) })
    if (!response.ok) return false
    const models = await response.json()
    return Array.isArray(models?.openvino_models) && models.openvino_models.includes(FASTSD_MODEL)
  } catch { return false }
}

function run(command, args, cwd, timeoutMs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: 'ignore', shell: false })
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill()
      reject(new Error('Tiempo de instalación agotado. Consulta el instalador de FastSD CPU.'))
    }, timeoutMs)
    child.once('error', error => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', code => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      code === 0 ? resolveRun() : reject(new Error('Instalación FastSD CPU terminada con código ' + code))
    })
  })
}

async function ensureInstalled() {
  const root = fastsdRoot()
  const python = join(root, 'env', process.platform === 'win32' ? 'Scripts' : 'bin',
    process.platform === 'win32' ? 'python.exe' : 'python')
  if (existsSync(python) && ready()) return python
  if (process.platform !== 'win32' || process.env.PHOENIX_FASTSD_AUTOINSTALL === '0') {
    throw new Error('FastSD CPU no está instalado. En Windows: powershell -NoProfile -ExecutionPolicy Bypass -File .\\scripts\\phoenix-fastsd-setup.ps1')
  }
  await run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File',
    join(PROJECT_ROOT, 'scripts', 'phoenix-fastsd-setup.ps1')], PROJECT_ROOT, 30 * 60_000)
  if (!existsSync(python) || !ready()) throw new Error('La instalación FastSD no se pudo verificar.')
  return python
}

async function startBackend() {
  if (await probe()) return
  if (backendStart) return backendStart
  backendStart = (async () => {
    const python = await ensureInstalled()
    const root = fastsdRoot()
    const script = "import sys;sys.path.insert(0,'src');import uvicorn;from backend.api.web import app;uvicorn.run(app,host='127.0.0.1',port=" + PORT + ")"
    const env = { ...process.env, HF_HUB_CACHE: join(root, 'hub'), HUGGINGFACE_HUB_CACHE: join(root, 'hub') }
    const libs = join(root, 'env', 'Lib', 'site-packages', 'openvino', 'libs')
    env.PATH = (env.PATH || env.Path || '') + (process.platform === 'win32' ? ';' : ':') + libs
    backend = spawn(python, ['-c', script], { cwd: root, env, stdio: 'ignore', windowsHide: true })
    let childError
    backend.once('error', e => { childError = e })
    const startedAt = Date.now()
    while (Date.now() - startedAt < 100_000) {
      if (await probe()) return
      if (childError || backend.exitCode !== null) break
      await new Promise(resolveDelay => setTimeout(resolveDelay, 750))
    }
    if (backend?.exitCode === null) backend.kill()
    throw new Error('FastSD CPU OpenVINO no inició en 127.0.0.1:' + PORT +
      (childError ? ' (' + childError.message + ')' : '. Verifica Python, RAM y el modelo instalado.'))
  })()
  try { await backendStart } finally { backendStart = undefined }
}

function releaseAfterIdle() {
  clearTimeout(idleTimer)
  idleTimer = setTimeout(() => {
    if (backend?.exitCode === null) backend.kill()
    backend = undefined
  }, 120_000)
  idleTimer.unref?.()
}

export function decodeImage(value) {
  if (typeof value !== 'string' || value.length > 20_000_000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('FastSD devolvió una imagen codificada inválida.')
  }
  const bytes = Buffer.from(value, 'base64')
  if (bytes.length < 32 || bytes.length > 12_000_000 || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error('FastSD no devolvió un JPEG válido o excedió el límite de tamaño.')
  }
  return bytes
}

async function generate(prompt, options) {
  clearTimeout(idleTimer)
  await startBackend()
  const request = generationRequest(prompt, options)
  const response = await fetch(ORIGIN + '/api/generate', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error('FastSD respondió HTTP ' + response.status)
  const result = await response.json()
  if (result?.error) throw new Error(String(result.error).slice(0, 240))
  if (!Array.isArray(result?.images) || result.images.length !== 1) {
    throw new Error('FastSD no produjo exactamente una imagen.')
  }
  const bytes = decodeImage(result.images[0])
  // Never delete old model weights until the replacement has generated real pixels.
  mkdirSync(fastsdRoot(), { recursive: true })
  writeFileSync(verifiedFile(), FASTSD_REVISION + '\n')
  try { retireLegacyModel() } catch (error) {
    process.stderr.write('[PHOENIX FastSD] Limpieza pendiente: ' + error.message + '\n')
  }
  if (options?.migrationOnly === true) return { model: FASTSD_MODEL, latency: result.latency }
  const fileId = randomBytes(16).toString('hex')
  const root = imageRoot()
  mkdirSync(root, { recursive: true, mode: 0o700 })
  const path = join(root, fileId + '.jpg')
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 })
  const markdown = '![Imagen generada localmente](/local-images/' + fileId + '.jpg)'
  return { fileId, markdown, path, model: FASTSD_MODEL, latency: result.latency }
}

export const tools = [{
  name: 'generate_image',
  description: 'Genera una imagen ORIGINAL local solamente cuando el usuario la solicita explícitamente. Usa FLUX.2 Klein 4B INT4 OpenVINO 512x512 sobre CPU, separado de Ollama. Tras terminar, incluye literalmente el campo markdown devuelto en tu respuesta, para que el usuario vea la imagen en el chat. No prometas precisión anatómica ni diagnóstico médico.',
  inputSchema: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Descripción detallada de la imagen, en español o inglés.' },
      negative_prompt: { type: 'string', description: 'Elementos que se desean evitar (opcional).' },
      seed: { type: 'integer', minimum: 0, maximum: 2147483647, description: 'Semilla reproducible opcional.' },
    },
    required: ['prompt'],
    additionalProperties: false,
  },
}, {
  name: 'image_status',
  description: 'Comprueba la instalación y el estado local de FastSD CPU OpenVINO sin descargar modelos ni generar imágenes.',
  inputSchema: { type: 'object', properties: {}, additionalProperties: false },
}]

async function invoke(name, args) {
  if (name === 'image_status') {
    return {
      installed: existsSync(join(fastsdRoot(), 'env', process.platform === 'win32' ? 'Scripts' : 'bin',
        process.platform === 'win32' ? 'python.exe' : 'python')),
      api_ready: await probe(),
      model: FASTSD_MODEL,
      engine: 'FastSD CPU / OpenVINO',
    }
  }
  if (name !== 'generate_image') throw new Error('Herramienta desconocida')
  const task = () => generate(args?.prompt, args ?? {}).finally(releaseAfterIdle)
  const next = queue.then(task, task)
  queue = next.then(() => undefined, () => undefined)
  return next
}

async function message(request) {
  if (!request || typeof request !== 'object' || !Object.hasOwn(request, 'id')) return
  const id = request.id
  try {
    switch (request.method) {
      case 'initialize':
        return { jsonrpc: '2.0', id, result: {
          protocolVersion: request.params?.protocolVersion ?? '2025-03-26',
          capabilities: { tools: {} },
          serverInfo: { name: 'phoenix-fastsd-openvino', version: '2.0.0' },
        } }
      case 'ping':
        return { jsonrpc: '2.0', id, result: {} }
      case 'tools/list':
        return { jsonrpc: '2.0', id, result: { tools } }
      case 'tools/call':
        try {
          const data = await invoke(request.params?.name, request.params?.arguments)
          const output = typeof data === 'object' ? JSON.stringify(data) : String(data)
          return { jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: output }] } }
        } catch (error) {
          return { jsonrpc: '2.0', id, result: { isError: true,
            content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] } }
        }
      default:
        return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
    }
  } catch {
    return { jsonrpc: '2.0', id, error: { code: -32603, message: 'Internal error' } }
  }
}

const entry = process.argv[1] && resolve(process.argv[1]) === THIS
if (entry) {
  if (process.argv.includes('--migrate-only')) {
    // Only existing installations migrate automatically; new users keep on-demand setup.
    try {
      if (process.env.PHOENIX_FASTSD_AUTOINSTALL !== '0' && process.env.PHOENIX_FASTSD_ENABLE !== '0'
        && existsSync(join(legacyFastsdRoot(), '.phoenix-fastsd-ready'))) {
        if (existsSync(verifiedFile())) {
          if (!existsSync(migratedFile())) retireLegacyModel()
        } else {
          await generate('A simple blue ceramic cup on a wooden table, soft daylight, photograph', { migrationOnly: true })
        }
        process.stdout.write(JSON.stringify({ ok: true, model: FASTSD_MODEL }) + '\n')
      }
    } catch (error) {
      process.stderr.write('[PHOENIX FastSD] Migración pendiente: ' + error.message + '\n')
      process.exitCode = 1
    } finally {
      if (backend?.exitCode === null) backend.kill()
    }
  } else if (process.argv.includes('--generate-once')) {
    // This isolated worker is invoked before Kira assembles any model context.
    // The stdin JSON carries exactly one fresh user image prompt, not a session.
    let input = ''
    try {
      for await (const part of process.stdin) {
        input += part.toString('utf8')
        if (input.length > 4096) throw new Error('La petición local excede 4096 caracteres.')
      }
      const payload = JSON.parse(input)
      if (!payload || typeof payload !== 'object' || typeof payload.prompt !== 'string') {
        throw new Error('Prompt de imagen local inválido.')
      }
      const result = await generate(payload.prompt)
      process.stdout.write(JSON.stringify({ ok: true, markdown: result.markdown, model: result.model }) + '\n')
    } catch (error) {
      process.stdout.write(JSON.stringify({
        ok: false, error: error instanceof Error ? error.message.slice(0, 280) : 'Error de imagen local',
      }) + '\n')
      process.exitCode = 1
    } finally {
      clearTimeout(idleTimer)
      if (backend?.exitCode === null) backend.kill()
    }
  } else {
    const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
    for await (const line of lines) {
      try {
        const result = await message(JSON.parse(line))
        if (result) process.stdout.write(JSON.stringify(result) + '\n')
      } catch {
        // Never emit unframed text on an MCP stdio transport.
      }
    }
    clearTimeout(idleTimer)
    if (backend?.exitCode === null) backend.kill()
  }
}
