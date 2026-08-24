#!/usr/bin/env node
/** Best-effort local SearXNG bootstrap for PHOENIX HARDNESS. */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const compose = join(root, '.phoenix', 'searxng', 'compose.yml')
const endpoint = process.env.PHOENIX_SEARXNG_URL ?? 'http://127.0.0.1:8888'

async function healthy(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1_200)
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' })
    return response.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function docker(args) {
  return spawnSync(process.platform === 'win32' ? 'docker.exe' : 'docker', args, {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'inherit',
  })
}

async function ensure() {
  if (await healthy(endpoint)) return true
  if (process.env.PHOENIX_SEARXNG_URL !== undefined) {
    console.error(`[PHOENIX WEB] configured SearXNG is unavailable at ${endpoint}; web_search will fail closed until it is reachable.`)
    return false
  }
  if (!existsSync(compose)) return false
  const probe = spawnSync(process.platform === 'win32' ? 'docker.exe' : 'docker', ['compose', 'version'], {
    cwd: root, encoding: 'utf8', windowsHide: true, stdio: 'ignore',
  })
  if (probe.status !== 0) {
    console.error('[PHOENIX WEB] Docker is not available; local SearXNG was not started. PHOENIX itself will continue normally.')
    return false
  }
  console.error('[PHOENIX WEB] starting the local keyless SearXNG search service...')
  const result = docker(['compose', '-f', compose, 'up', '-d'])
  if (result.status !== 0) {
    console.error('[PHOENIX WEB] local SearXNG startup failed; PHOENIX itself will continue normally.')
    return false
  }
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await healthy(endpoint)) {
      console.error(`[PHOENIX WEB] local SearXNG ready at ${endpoint}`)
      return true
    }
    await new Promise(resolveDelay => setTimeout(resolveDelay, 500))
  }
  console.error('[PHOENIX WEB] SearXNG container started but did not become ready yet; it may finish starting after PHOENIX opens.')
  return false
}

if (process.argv.includes('--ensure')) await ensure()
