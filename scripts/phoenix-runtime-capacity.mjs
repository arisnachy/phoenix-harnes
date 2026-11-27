import { lstatSync } from 'node:fs'
import { join } from 'node:path'

function isAbsent(path) {
  try {
    lstatSync(path)
    return false
  } catch (error) {
    return error?.code === 'ENOENT'
  }
}

/**
 * Reserve one temporary slot for an isolated update when Windows has left
 * exactly one fully detached runtime directory alongside a healthy Host.
 * Callers still enforce physical disk headroom and the shared directory cap.
 * @param {{directories: string[], registered: Set<string> | undefined, activePath: string | undefined, limit: number, pathKey: (path: string) => string}} options - Current runtime paths and Git registration.
 * @returns {boolean} Whether the detached directory qualifies for the reserve.
 */
export function hasDetachedRuntimeReserve({ directories, registered, activePath, limit, pathKey }) {
  if (directories.length !== limit || !registered || !activePath) return false
  const activeKey = pathKey(activePath)
  if (!registered.has(activeKey) || !directories.some(path => pathKey(path) === activeKey)) return false

  const detached = directories.filter(path => !registered.has(pathKey(path)))
  if (detached.length !== 1) return false
  const [path] = detached
  try {
    return lstatSync(path).isDirectory()
      && isAbsent(join(path, '.git'))
      && isAbsent(join(path, '.phoenix-keep'))
  } catch {
    return false
  }
}
