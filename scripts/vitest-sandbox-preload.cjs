'use strict'

// Vite 8 (rolldown) calls `exec("net use")` once per process on Windows to map
// UNC network drives onto drive letters before the first realpath resolution
// (see `optimizeSafeRealPathSync` in vite/dist/node/chunks/node.js). The PHOENIX
// execution sandbox rejects that child_process with `spawn EPERM`, so vitest
// dies while bundling vitest.config.ts — before a single test runs.
//
// This preload replaces that one call with an empty result so Vite falls back
// to `fs.realpathSync.native`. It is loaded only by `scripts/test-sandbox.mjs`
// (never by CI or by the plain `pnpm test` path), and it never touches any
// other child_process call, so it cannot change product behavior.
const cp = require('node:child_process')
const { EventEmitter } = require('node:events')

const realExec = cp.exec

/** @param {string} command */
function isNetUse(command) {
  const cmd = typeof command === 'string' ? command.trim().toLowerCase() : ''
  return cmd === 'net use' || cmd.startsWith('net use ')
}

cp.exec = function exec(command, options, callback) {
  if (!isNetUse(command)) return realExec.apply(this, arguments)

  const cb = typeof options === 'function' ? options : callback
  const child = new EventEmitter()
  child.stdout = { setEncoding() {}, on() {}, removeListener() {}, pipe() { return this } }
  child.stderr = { setEncoding() {}, on() {}, removeListener() {}, pipe() { return this } }
  child.stdin = { end() {}, on() {} }
  if (typeof cb === 'function') process.nextTick(() => cb(null, '', ''))
  return child
}
